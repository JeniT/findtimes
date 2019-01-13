/* global gapi */
/* global Vue */
/* global moment */
/* global M */
/* global URL */
/* global google */
/* global APP_SLOT_KIND */
/* global APP_TRAVEL_KIND */
/* global timeOnDay */
/* global fetchCalendarEvents */
/* global sortEvents */
/* global addSlotsBetween */
/* global calculateTravelTime */

// Client ID and API key from the Developer Console
var CLIENT_ID = '580782451843-c3hia6gsl157hihk25tl4cqoil3gpi3u.apps.googleusercontent.com';
var API_KEY = 'AIzaSyAXqF7CUsCRncsTULLaHqNBtTnrtT-e1ic';
var MAPS_API_KEY = 'AIzaSyAkGSArjk9-AqZ8D__hViDeNr4leO6Q_PU';

// Array of API discovery doc URLs for APIs used by the quickstart
var DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
var SCOPES = "profile https://www.googleapis.com/auth/calendar.events";

var COLORS = {
  1: 'light-blue',
  2: 'light-green',
  3: 'purple',
  4: 'deep-orange',
  5: 'amber',
  6: 'cyan',
  7: 'grey',
  8: 'blue',
  9: 'green',
  10: 'red',
  11: 'pink'
};

var HOLD_PREFIX = "[HOLD] ";

/**
 *  On load, called to load the auth2 library and API client library.
 */
function handleClientLoad() {
  gapi.load('client:auth2', initClient);
}

/**
 *  Initializes the API client library and sets up sign-in state
 *  listeners.
 */
function initClient() {
  gapi.client.init({
    apiKey: API_KEY,
    clientId: CLIENT_ID,
    discoveryDocs: DISCOVERY_DOCS,
    scope: SCOPES
  }).then(function() {
    // Listen for sign-in state changes.
    gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);

    // Handle the initial sign-in state.
    updateSigninStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
  }, function(error) {
    console.log('init error');
    console.log(error);
  });
}

/**
 *  Called when the signed in status changes, to update the UI
 *  appropriately. After a sign-in, the API is called.
 */
function updateSigninStatus(isSignedIn) {
  app.connected = isSignedIn;
  if (isSignedIn) {
    app.getUserProfile();
    app.getCalendarList();
    app.getHolds();
    app.refresh();
  }
}

/**
 *  Sign in the user upon button click.
 */
function handleAuthClick(event) {
  gapi.auth2.getAuthInstance().signIn();
}

/**
 *  Sign out the user upon button click.
 */
function handleSignoutClick(event) {
  gapi.auth2.getAuthInstance().signOut();
}

var mapsService;

function initMap(response) {
  mapsService = new google.maps.DistanceMatrixService();
  app.updateCommuteTimes();
}

Vue.component('hold-listing-collapsible', {
  props: ['events'],
  data: function() {
    return {
      loading: false
    };
  },
  computed: {
    summary: function() {
      var summary = this.events[0].summary;
      return summary.substr(0, HOLD_PREFIX.length) === HOLD_PREFIX ? summary.substr(HOLD_PREFIX.length) : summary;
    }
  },
  mounted: function() {
    var collapsibles = document.querySelectorAll('.collapsible');
    M.Collapsible.init(collapsibles, {
      accordion: true
    });

    var modals = this.$el.querySelectorAll('.modal');
    M.Modal.init(modals);
  },
  methods: {
    refresh: function(event) {
      app.updateEventViews(event);
    },
    formatEvent: function(event) {
      return moment(event.start.dateTime).format('ddd MMM DD') + " " +
        moment(event.start.dateTime).format('HH:mm') + " - " +
        moment(event.end.dateTime).format('HH:mm');
    },
    copySummary: function(e) {
      var text = document.querySelector('.modal.open ul');
      text.setAttribute('contenteditable', true);
      text.focus();
      document.execCommand('selectAll');
      document.execCommand('copy');
      document.getSelection().removeAllRanges();
      text.setAttribute('contenteditable', false);
    },
    hide: function(e) {
      this.loading = true;
    }
  },
  template: `
      <li>
        <div class="collapsible-header">
          <b>{{summary}}</b>
          <span class="new badge" data-badge-caption="held slots">{{events.length}}</span>
        </div>
        <div class="collapsible-body">
          <div class="progress" v-bind:class="{hide: !loading}"><div class="indeterminate"></div></div>
          <div v-bind:class="{hide: loading}">
              <div class="right-align">
                <a v-bind:href="'#' + encodeURIComponent(summary)" class="btn-flat modal-trigger">Summary</a>
              </div>
              <div v-bind:id="encodeURIComponent(summary)" class="modal">
                <div class="modal-content">
                  <h5>{{summary}}</h5>
                  <p>Currently holding:</p>
                  <ul>
                    <li v-for="event in events">{{ formatEvent(event) }}</li>
                  </ul>
                </div>
                <div class="modal-footer">
                  <a href="" v-on:click.prevent="copySummary" class="btn-flat waves-effect waves-amber">Copy</a>
                  <a href="#!" class="modal-close btn-flat">Close</a>
                </div>
              </div>
              <ul class="collection">
                <li is="event-collection-item" v-for="event in events" :key="'held-' + event.id" v-bind:event="event" v-bind:context="'held'"
                    v-on:updated="refresh" v-on:before-confirm="hide"></li>
              </ul>
          </div>
        </div>
      </li>
    `
})

Vue.component('day-expandable', {
  props: ['date'],
  data: function() {
    return {
      events: [],
      expanded: false,
      error: true
    };
  },
  computed: {
    formattedDate: function() {
      return moment(this.date).format('ddd MMM DD');
    },
    numberOfSlots: function() {
      return this.events.reduce((count, event) => count + (event.kind === APP_SLOT_KIND), 0);
    },
    numberOfHeldSlots: function() {
      return this.events.reduce((count, event) => count + (event.extendedProperties !== undefined && event.extendedProperties.private !== undefined && (event.extendedProperties.private.findtimesHolding === "true")), 0);
    }
  },
  methods: {
    refresh: function(propagate = true) {
      var dayStart = timeOnDay(this.date, app.commuteStartTime);
      var dayEnd = timeOnDay(this.date, app.commuteEndTime);
      var searchStart = timeOnDay(this.date, app.startTime);
      var searchEnd = timeOnDay(this.date, app.endTime);

      var duration = app.lasting;
      var dayExpandable = this;
      fetchCalendarEvents(app.invite.concat(['primary']), dayStart, dayEnd, function(events) {
        dayExpandable.error = false;
        events = events.sort(sortEvents);
        events = events.filter(function(e, i) { if ((i == 0) || (events[i - 1].id !== e.id)) return e; });
        events = addSlotsBetween(dayStart, dayEnd, duration, app.homeAddress, events).sort(sortEvents);
        dayExpandable.events = events.filter(e =>
          searchStart.isBefore(e.end.dateTime || e.end.date) &&
          searchEnd.isAfter(e.start.dateTime || e.start.date)
        );
        // dayExpandable.events = events;
        if (propagate) {
          dayExpandable.$emit('updated');
        }
      }, function(calendarId, error) {
        if (calendarId === 'primary') {
          dayExpandable.error = true;
        } else {
          app.invite = app.invite.filter((i) => i !== calendarId);
          app.ignoreInvite(calendarId);
        }
      });
    }
  },
  mounted: function() {
    if (app.connected) {
      this.refresh(false);
    } else {
      console.log('app not connected when mounted');
    }
  },
  watch: {
    date: function() {
      this.refresh();
    }
  },
  template: `
        <li v-bind:class="{ expanded: expanded }">
            <div class="collapsible-header" v-on:click="expanded = !expanded">
                <i v-if="expanded" class="medium material-icons teal-text">expand_less</i>
                <i v-else class="medium material-icons teal-text">expand_more</i>
                <b>{{formattedDate}}</b>
                <span v-if="numberOfHeldSlots > 0" class="new badge orange" 
                    v-bind:data-badge-caption="'slot' + (numberOfHeldSlots === 1 ? '' : 's') + ' held'">{{numberOfHeldSlots}}</span>
                <span class="badge" v-bind:class="{ new: numberOfSlots > 0 }" 
                    v-bind:data-badge-caption="'available slot' + (numberOfSlots === 1 ? '' : 's')">{{numberOfSlots}}</span>
            </div>
            <div class="collapsible-body" v-bind:style="{ display: expanded ? 'block' : 'none' }">
                <div v-if="error" class="row">
                    <div class="col s9">Couldn't load events.</div>
                    <div class="col s3"><a href="" v-on:click.prevent="refresh" class="btn-flat waves-effect waves-light amber"><i class="material-icons left">refresh</i>Try again</a></div>
                </div>
                <ul v-else class="collection">
                    <li is="event-collection-item" v-for="event in events" :key="event.id" v-bind:event="event" v-bind:context="'agenda'" v-on:updated="refresh"></li>
                </ul>
            </div>
        </li>
    `
});

Vue.component('event-collection-item', {
  props: ['event', 'context'],
  computed: {
    ownEvent: function() {
      return this.context === "held" || this.event.calendarId === 'primary';
    },
    isSlot: function() {
      return this.event.kind === APP_SLOT_KIND;
    },
    isTravel: function() {
      return this.event.kind === APP_TRAVEL_KIND;
    },
    allDay: function() {
      return this.event.start.dateTime === undefined;
    },
    isDesiredDuration: function() {
      var currentDuration = moment(this.event.end.dateTime).diff(this.event.start.dateTime, 'minutes');
      if (this.isSlot) {
        return currentDuration === app.lasting;
      } else if (this.holding) {
        var desiredDuration = Number.parseInt(this.event.extendedProperties.private.findtimesDuration);
        return currentDuration === desiredDuration;
      } else {
        return true;
      }
    },
    organizer: function() {
      if (this.event.organizer) {
        return this.event.organizer.self ? "you" : (this.event.organizer.displayName || this.event.organizer.email);
      } else {
        return this.event.calendarId;
      }
    },
    otherPeople: function() {
      var people = [];
      var ownEvent = this.ownEvent;
      if (this.event.attendees) {
        people = this.event.attendees.filter(attendee => (!ownEvent || !attendee.self) && !attendee.resource);
      } else if (!this.ownEvent) {
        people = [{
          email: this.event.calendarId
        }];
      }
      return people;
    },
    includesInvitees: function() {
      var attendees = this.event.attendees;
      if (attendees) {
        var check = attendees.concat([app.ownEmail]);
        return app.invite.every(person => check.some(a => a.email === person));
      } else {
        return false;
      }
    },
    onlyInvitees: function() {
      return this.includesInvitees && app.invite.length === this.otherPeople.length;
    },
    peopleTooltip: function() {
      return 'Existing meeting with ' + app.invite.join(', ') + (!this.onlyInvitees ? ' and others' : '');
    },
    attending: function() {
      var attending = "accepted";
      if (this.event.attendees) {
        var ownAttendance = this.event.attendees.find(attendee => attendee.self);
        attending = ownAttendance !== undefined ? ownAttendance.responseStatus : "accepted";
      } else if (!this.ownEvent) {
        return "other";
      }
      return attending;
    },
    holding: function() {
      return this.event.extendedProperties &&
        this.event.extendedProperties.private &&
        this.event.extendedProperties.private.findtimesHolding === "true";
    },
    color: function() {
      // TODO get color from calendar if you know it
      return this.event.colorId ? COLORS[this.event.colorId] : 'teal';
    },
    classes: function() {
      var classes = {};
      if (!this.isSlot && !this.isTravel) {
        if (!this.ownEvent) {
          classes = {
            'blue-grey': true,
            'lighten-2': true,
            'blue-grey-text': true,
            'text-lighten-5': true,
            'hide': this.event.transparency == "transparent"
          }
        } else if (this.event.transparency == "transparent" || this.attending !== "accepted") {
          classes = {
            'text-darken-3': true
          };
          classes[this.color + "-text"] = true;
        } else {
          classes = {
            'white-text': true,
            'darken-3': true
          };
          if (this.holding) {
            classes['orange'] = true;
          } else {
            classes[this.color] = true;
          }
        }
      }
      classes[this.attending] = true;
      classes["transparent"] = this.event.transparency == "transparent";
      classes["slot"] = this.isSlot;
      classes["travel"] = this.isTravel;
      return classes;
    },
    dateClasses: function() {
      var classes = {};
      if (!this.isSlot && !this.isTravel) {
        if (!this.ownEvent) {
          classes = {
            'blue-grey-text': true,
            'text-lighten-3': true
          }
        } else {
          if (this.holding) {
            classes['orange-text'] = true;
          } else {
            classes[this.color + "-text"] = true;
          }
          if (this.event.transparency !== "transparent" || this.attending == "declined") {
            classes["text-lighten-3"] = true;
          }
        }
      }
      return classes;
    },
    formattedDate: function() {
      if (this.allDay) {
        return moment(this.event.start.date).format('MMM DD');
      } else {
        var start = moment(this.event.start.dateTime);
        var end = moment(this.event.end.dateTime);
        var startDate = start.format('MMM DD');
        var endDate = end.format('MMM DD');
        return startDate + " " +
          start.format('HH:mm') + " - " +
          (endDate !== startDate ? (endDate + " ") : "") +
          end.format('HH:mm');
      }
    },
    formattedStartTime: function() {
      return moment(this.event.start.dateTime).format('HH:mm');
    },
    formattedTravelMode: function() {
      switch (this.event.mode) {
        case "walking":
          return "foot";
        case "driving":
          return "car";
        case "transit":
          return "public transport";
        case "bicycling":
          return "bike";
      }
    }
  },
  mounted: function() {
    var dropdowns = this.$el.querySelectorAll('.dropdown-trigger');
    M.Dropdown.init(dropdowns, {
      constrainWidth: false,
      hover: true
    });

    var tooltipped = this.$el.querySelectorAll('.tooltipped');
    M.Tooltip.init(tooltipped);

    var eventCollectionItem = this;
    var timepickers = this.$el.querySelectorAll('.timepicker');
    M.Timepicker.init(timepickers, {
      twelveHour: false,
      autoClose: true,
      container: '#manage',
      defaultTime: moment(eventCollectionItem.event.start.dateTime).format('HH:mm'),
      onCloseEnd: function() {
        if (!this.time) return;
        var oldStart = eventCollectionItem.event.start.dateTime;
        var newStart = timeOnDay(oldStart, this.time);
        var oldEnd = eventCollectionItem.event.end.dateTime;
        var newEnd = moment(newStart).add({ minutes: app.lasting });
        if (newStart.isBefore(oldStart) || newEnd.isAfter(oldEnd)) {
          M.toast({ html: 'Time must be between ' + moment(oldStart).format('HH:mm') + ' and ' + moment(oldEnd).format('HH:mm') });
        } else {
          eventCollectionItem.event.start.dateTime = newStart;
          eventCollectionItem.event.end.dateTime = newEnd;
          if (this.$el.hasClass('hold')) {
            eventCollectionItem.hold('all');
          } else if (this.$el.hasClass('confirm')) {
            eventCollectionItem.confirm();
          } else {
            eventCollectionItem.book('all');
          }
        }
      }
    });
  },
  methods: {
    openTimepicker: function(context) {
      var timepicker = this.$el.querySelector('.timepicker.' + context);
      timepicker.M_Timepicker.open();
    },
    updateAttendance: function(newResponseStatus) {
      var event = this;
      gapi.client.calendar.events.get({
        'calendarId': 'primary',
        'eventId': event.event.id
      }).then(function(response) {
        var currentEvent = response.result;
        var newAttendees = currentEvent.attendees;
        newAttendees.map(function(attendee) {
          if (attendee.self) {
            attendee.responseStatus = newResponseStatus;
          }
        });
        var newEvent = {
          'calendarId': 'primary',
          'eventId': event.event.id,
          'attendees': newAttendees
        };
        gapi.client.calendar.events.patch(newEvent).then(function(response) {
          event.$emit('updated', event.event);
        });
      });
    },
    confirm: function() {
      var event = this;
      event.$emit('before-confirm');
      gapi.client.calendar.events.get({
        'calendarId': 'primary',
        'eventId': event.event.id
      }).then(function(response) {
        var currentEvent = response.result;
        var oldSummary = currentEvent.summary;
        var newSummary = oldSummary.substr(0, HOLD_PREFIX.length) === HOLD_PREFIX ? oldSummary.substr(HOLD_PREFIX.length) : oldSummary;
        var attendees = [];
        if (currentEvent.extendedProperties &&
          currentEvent.extendedProperties.private &&
          currentEvent.extendedProperties.private.findtimesInvite) {
          currentEvent.extendedProperties.private.findtimesInvite.split(',').forEach(function(invitee) {
            if (invitee !== "") {
              attendees.push({
                'email': invitee
              });
            }
          });
          if (attendees.length > 0) {
            attendees.push({
              'email': app.ownEmail,
              'responseStatus': 'accepted'
            });
          }
        }
        var newEvent = {
          'calendarId': 'primary',
          'eventId': event.event.id,
          'summary': newSummary,
          'start': event.event.start,
          'end': event.event.end,
          'status': 'confirmed',
          'attendees': attendees,
          'extendedProperties': {
            'private': {
              'findtimesHolding': false
            }
          }
        };
        var conferenceSolutionType = app.ownCalendar.conferenceProperties.allowedConferenceSolutionTypes[0];
        if (attendees.length > 0 && conferenceSolutionType) {
          newEvent.conferenceDataVersion = 1;
          newEvent.conferenceData = {
            createRequest: {
              conferenceSolutionKey: {
                type: conferenceSolutionType,
                requestId: event.event.id + "-" + conferenceSolutionType
              }
            }
          };
        }
        gapi.client.calendar.events.patch(newEvent).then(function(response) {
          gapi.client.calendar.events.list({
            'calendarId': 'primary',
            'timeMin': (new Date()).toISOString(),
            'showDeleted': false,
            'singleEvents': true,
            'orderBy': 'startTime',
            'q': oldSummary,
            'privateExtendedProperty': 'findtimesHolding=true'
          }).then(function(response) {
            var heldEvents = response.result.items;
            heldEvents.forEach(function(heldEvent) {
              gapi.client.calendar.events.delete({
                calendarId: 'primary',
                eventId: heldEvent.id
              }).then(function(response) {
                app.updateEventViews(heldEvent);
              }, function(error) {
                console.log(error);
              });
            });
          }, function(error) {
            console.log(error);
          });
          event.$emit('updated', event.event);
        }, function(error) {
          console.log(error);
        });
      });
    },
    accept: function() {
      this.updateAttendance("accepted");
    },
    decline: function() {
      this.updateAttendance("declined");
    },
    deleteEvent: function() {
      var event = this;
      gapi.client.calendar.events.delete({
        calendarId: 'primary',
        eventId: this.event.id
      }).then(function(response) {
        event.$emit('updated', event.event);
      }, function(error) {
        console.log(error);
      });
    },
    hold: function(extent = 'all') {
      var event = this;
      var holdEvent = {
        calendarId: 'primary',
        summary: "[HOLD] " + (app.summary || "reserved"),
        start: (extent === 'all' || extent === 'start') ? this.event.start : { dateTime: moment(this.event.end.dateTime).subtract({ minutes: app.lasting }).toISOString() },
        end: (extent === 'all' || extent === 'end') ? this.event.end : { dateTime: moment(this.event.start.dateTime).add({ minutes: app.lasting }).toISOString() },
        status: "tentative",
        extendedProperties: {
          'private': {
            findtimesHolding: true,
            findtimesInvite: app.invite.join(','),
            findtimesDuration: app.lasting
          }
        }
      };
      gapi.client.calendar.events.insert(holdEvent).then(function(response) {
        event.$emit('updated', event.event);
      }, function(error) {
        console.log(error);
      });
    },
    book: function(extent = 'all') {
      var event = this;
      var bookEvent = {
        calendarId: 'primary',
        summary: (app.summary || "reserved"),
        start: (extent === 'all' || extent === 'start') ? this.event.start : { dateTime: moment(this.event.end.dateTime).subtract({ minutes: app.lasting }).toISOString() },
        end: (extent === 'all' || extent === 'end') ? this.event.end : { dateTime: moment(this.event.start.dateTime).add({ minutes: app.lasting }).toISOString() },
        status: "confirmed",
      };
      var attendees = [];
      var conferenceSolutionType = app.ownCalendar.conferenceProperties.allowedConferenceSolutionTypes[0];
      if (app.invite.length > 0) {
        app.invite.forEach(function(invitee) {
          if (invitee !== "") {
            attendees.push({
              'email': invitee
            });
          }
        });
        if (attendees.length > 0) {
          attendees.push({
            'email': app.ownEmail,
            'responseStatus': 'accepted'
          });
          bookEvent.attendees = attendees;
          if (conferenceSolutionType) {
            bookEvent.conferenceDataVersion = 1;
            bookEvent.conferenceData = {
              createRequest: {
                conferenceSolutionKey: {
                  type: conferenceSolutionType,
                  requestId: this.event.id + "-" + conferenceSolutionType
                }
              }
            };
          }
        }
      }
      gapi.client.calendar.events.insert(bookEvent).then(function(response) {
        event.$emit('updated', event.event);
      }, function(error) {
        console.log(error);
      });
    }
  },
  template: `
    <li class="collection-item" v-bind:class="classes">
      <div v-if="isSlot || isTravel">
        <div v-if="isSlot">
          <div class="secondary-content">
            <div v-if="isDesiredDuration">
              <a href="#" class="btn-flat orange white-text waves-effect waves-light" 
                v-on:click.prevent="hold">Hold</a>
              <a href="#" class="btn-flat teal white-text waves-effect waves-light"
                v-on:click.prevent="book">Book</a>
            </div>
            <div v-else>
              <a href="#" class="dropdown-trigger btn-flat orange white-text waves-effect waves-light" 
                v-bind:data-target='context + "hold" + event.id'>Hold</a>
              <ul v-bind:id='context + "hold" + event.id' class='dropdown-content'>
                <li><a href="" v-on:click.prevent="hold('all')"><i class="material-icons">select_all</i>Whole slot</a></li>
                <li><a href="" v-on:click.prevent="openTimepicker('hold')"><i class="material-icons">access_time</i>Start from...</a></li> 
                <li><a href="" v-on:click.prevent="hold('start')"><i class="material-icons">vertical_align_top</i>At start</a></li>
                <li><a href="" v-on:click.prevent="hold('end')"><i class="material-icons">vertical_align_bottom</i>At end</a></li>
              </ul>
              <input type="text" class="timepicker hold hide" placeholder="" v-bind:value="formattedStartTime">
              <a href="#" class="dropdown-trigger btn-flat teal white-text waves-effect waves-light"
                v-bind:data-target='context + "book" + event.id'>Book</a>
              <ul v-bind:id='context + "book" + event.id' class='dropdown-content'>
                <li><a href="" v-on:click.prevent="openTimepicker('book')"><i class="material-icons">access_time</i>Start from...</a></li> 
                <li><a href="" v-on:click.prevent="book('start')"><i class="material-icons">vertical_align_top</i>At start</a></li>
                <li><a href="" v-on:click.prevent="book('end')"><i class="material-icons">vertical_align_bottom</i>At end</a></li>
              </ul>
              <input type="text" class="timepicker book hide" placeholder="" v-bind:value="formattedStartTime">
            </div>
          </div>
          <span class="title">Available</span>
          <br />
          <span class="grey-text">{{formattedDate}}</span>
        </div>
        <div v-if="isTravel">
          <span class="title">Travel</span><br/>
          {{event.origin.split(',')[0]}} to {{event.destination.split(',')[0]}}
          <br />
          <span class="grey-text">{{formattedDate}}</span> by {{formattedTravelMode}}
        </div>
      </div>
      <div v-else>
        <div v-if="ownEvent" class="secondary-content">
          <span v-if="onlyInvitees" class="btn-flat tooltipped" data-position="left" 
            v-bind:data-tooltip="peopleTooltip" v-bind:class="classes">
            <i class="material-icons">people</i>
          </span>
          <span v-if="includesInvitees && !onlyInvitees" class="btn-flat tooltipped" data-position="left" 
            v-bind:data-tooltip="peopleTooltip" v-bind:class="classes">
            <i class="material-icons">people_outline</i>
          </span>
          <a class='dropdown-trigger btn-flat' v-bind:class="classes" href='#' v-bind:data-target='context + "edit" + event.id'>
            <i class="material-icons">more_vert</i>
          </a>
          <ul v-bind:id='context + "edit" + event.id' class='dropdown-content'>
            <li><a v-bind:href="event.htmlLink" target="_new"><i class="material-icons">open_in_new</i>View</a></li>
            <li v-if="holding">
              <a v-if="isDesiredDuration" href="" v-on:click.prevent="confirm"><i class="material-icons">event_available</i>Confirm</a>
              <a v-else href="" v-on:click.prevent="openTimepicker('confirm')"><i class="material-icons">event_available</i>Confirm at...</a>
            </li>
            <li v-if="event.attendees !== undefined">
              <a v-if="attending != 'accepted'" href="" v-on:click.prevent="accept"><i class="material-icons">event_available</i>Accept</a>
              <span v-else class="grey-text"><i class="material-icons">event_available</i>Accept</span>
            </li>
            <li v-if="event.attendees !== undefined">
              <a v-if="attending != 'declined'" href="" v-on:click.prevent="decline"><i class="material-icons">event_busy</i>Decline</a>
              <span v-else class="grey-text"><i class="material-icons">event_busy</i>Decline</span>
            </li>
            <li v-if="ownEvent">
              <a href="" v-on:click.prevent="deleteEvent"><i class="material-icons">delete</i>Delete</a>
            </li>
          </ul>
          <input type="text" class="timepicker confirm hide" placeholder="" v-bind:value="formattedStartTime">
        </div>            
        <span class="title">
          <span v-if="event.summary">
            {{event.summary}}
            <span v-if="organizer !== 'you'"> with {{organizer}}</span>
          </span>
          <span v-else>
            {{organizer}} is busy
          </span>
        </span>
        <br />
        <span v-bind:class="dateClasses">{{formattedDate}}</span>
        {{event.location}}
      </div>
    </li>
    `
});

var urlParams = new URL(document.location).searchParams;
var searchDefaults = {
  summary: "",
  searchFromDate: moment().startOf('day').add({ days: 1 }),
  lasting: 60,
  within: 'P2W',
  invite: [],
  startTime: "09:30",
  endTime: "17:00",
  address: ""
};
var app = new Vue({
  el: '#app',
  data: {
    dates: [],
    connected: false,
    calendar: {},
    defaultStartTime: searchDefaults.startTime,
    defaultEndTime: searchDefaults.endTime,
    defaultWithin: searchDefaults.within,
    defaultLasting: searchDefaults.lasting,
    summary: urlParams.has('summary') ? urlParams.get('summary') : searchDefaults.summary,
    searchFromDate: urlParams.has('after') ? moment(urlParams.get('after')).startOf('day') : searchDefaults.searchFromDate,
    within: urlParams.has('within') ? urlParams.get('within') : this.defaultWithin,
    lasting: urlParams.has('lasting') ? Number.parseInt(urlParams.get('lasting')) : this.defaultLasting,
    invite: urlParams.has('invite') ? (urlParams.get('invite') === "" ? [] : urlParams.get('invite').split(",")) : searchDefaults.invite,
    ignore: [], // people on the invite list to ignore when fetching calendars (because you don't have access)
    address: urlParams.has('address') ? urlParams.get('address') : this.workAddress,
    checkAddress: false,
    invalidAddress: false,
    startTime: searchDefaults.startTime,
    endTime: searchDefaults.endTime,
    holding: [],
    calendars: [],
    profile: {},
    travelTimeEnabled: true,
    homeAddress: window.localStorage.getItem('homeAddress') || "",
    checkHomeAddress: false,
    invalidHomeAddress: false,
    workAddress: window.localStorage.getItem('workAddress') || "",
    checkWorkAddress: false,
    invalidWorkAddress: false,
    travelMode: window.localStorage.getItem('travelMode') || "transit",
    commuteStartTime: searchDefaults.startTime,
    commuteEndTime: searchDefaults.endTime,
    commuteToAddress: searchDefaults.startTime,
    commuteFromAddress: searchDefaults.endTime,
    travelToAddress: moment.duration(0),
    travelFromAddress: moment.duration(0),
    showMoreSearchOptions: false,
  },
  computed: {
    ownCalendar: function() {
      return this.calendars.find((c) => c.primary === true);
    },
    ownEmail: function() {
      return this.ownCalendar ? this.ownCalendar.id : "";
    },
    searchFrom: {
      get: function() {
        return moment(this.searchFromDate).format('MMM DD, YYYY');
      },
      set: function(value) {
        this.searchFromDate = moment(value, 'MMM DD, YYYY');
      }
    },
    showPreviousDate: function() {
      return this.searchFromDate.isAfter(moment().add({ days: 1 }));
    },
    url: {
      get: function() {
        var params = [];
        if (!searchDefaults.searchFromDate.isSame(this.searchFromDate)) params.push("after=" + moment(this.searchFromDate).format("YYYY-MM-DD"));
        if (this.within !== this.defaultWithin) params.push('within=' + this.within);
        if (this.lasting !== this.defaultLasting) params.push('lasting=' + this.lasting);
        if (this.summary !== searchDefaults.summary) params.push('summary=' + encodeURIComponent(this.summary));
        if (this.startTime !== this.defaultStartTime) params.push('startTime=' + this.startTime);
        if (this.endTime !== this.defaultEndTime) params.push('endTime=' + this.endTime);
        if (this.invite.length > 0) params.push('invite=' + this.invite.map((i) => encodeURIComponent(i)).join(","));
        if (this.address !== undefined && this.address !== "" && this.address !== this.workAddress) params.push('address=' + encodeURIComponent(this.address));
        return params.length > 0 ? ("?" + params.join('&')) : "";
      },
      set: function(url) {
        var urlParams = new URL(url).searchParams;
        this.summary = urlParams.has('summary') ? urlParams.get('summary') : searchDefaults.summary;
        this.searchFromDate = urlParams.has('after') ? moment(urlParams.get('after')).startOf('day') : searchDefaults.searchFromDate;
        this.lasting = urlParams.has('lasting') ? Number.parseInt(urlParams.get('lasting')) : this.defaultLasting;
        this.within = urlParams.has('within') ? moment.duration(urlParams.get('within')) : this.defaultWithin;
        this.invite = urlParams.has('invite') ? urlParams.get('invite').split(",") : searchDefaults.invite;
        this.startTime = urlParams.has('startTime') ? urlParams.get('startTime') : this.defaultStartTime;
        this.endTime = urlParams.has('endTime') ? urlParams.get('endTime') : this.defaultEndTime;
        this.address = urlParams.has('address') ? urlParams.get('address') : this.workAddress;
      }
    }
  },
  watch: {
    searchFromDate: function(newDate, oldDate) {
      this.refresh();
    },
    homeAddress: function(newAddress, oldAddress) {
      window.localStorage.setItem('homeAddress', newAddress);
      if (newAddress !== oldAddress) {
        this.checkHomeAddress = true;
      }
    },
    workAddress: function(newAddress, oldAddress) {
      window.localStorage.setItem('workAddress', newAddress);
      if (newAddress !== oldAddress) {
        this.checkWorkAddress = true;
      }
    },
    address: function(newAddress, oldAddress) {
      if (newAddress !== oldAddress) {
        this.checkAddress = true;
      }
    },
    travelMode: function(newMode, oldMode) {
      window.localStorage.setItem('travelMode', newMode);
      if (newMode !== oldMode) {
        this.updateCommuteTimes();
        this.updateTravelTimes();
      }
    },
    commuteStartTime: function(newValue, oldValue) {
      window.localStorage.setItem('commuteStartTime', newValue);
      if (newValue !== oldValue) {
        this.updateTravelTimes();
      }
    },
    commuteEndTime: function(newValue, oldValue) {
      window.localStorage.setItem('commuteEndTime', newValue);
      if (newValue !== oldValue) {
        this.updateTravelTimes();
      }
    },
    defaultStartTime: function(newTime, oldTime) {
      window.localStorage.setItem('defaultStartTime', newTime);
      if (newTime !== oldTime) {
        this.updateCommuteTimes();
        if (this.startTime === oldTime) {
          this.startTime = newTime;
        }
      }
    },
    defaultEndTime: function(newTime, oldTime) {
      window.localStorage.setItem('defaultEndTime', newTime);
      if (newTime !== oldTime) {
        this.updateCommuteTimes();
        if (this.endTime === oldTime) {
          this.endTime = newTime;
        }
      }
    },
    defaultWithin: function(newValue, oldValue) {
      window.localStorage.setItem('defaultWithin', newValue);
      if (newValue !== oldValue && this.within === oldValue) {
        this.within = newValue;
      }
    },
    defaultLasting: function(newValue, oldValue) {
      window.localStorage.setItem('defaultLasting', newValue);
      if (newValue !== oldValue && this.lasting === oldValue) {
        this.lasting = newValue;
      }
    },
  },
  mounted: function() {
    var app = this;
    this.defaultStartTime = window.localStorage.getItem('defaultStartTime') || this.defaultStartTime;
    this.defaultEndTime = window.localStorage.getItem('defaultEndTime') || this.defaultEndTime;
    this.defaultWithin = window.localStorage.getItem('defaultWithin') || this.defaultWithin;
    this.defaultLasting = Number.parseInt(window.localStorage.getItem('defaultLasting')) || this.defaultLasting;
    this.commuteStartTime = window.localStorage.getItem('commuteStartTime') || this.commuteStartTime;
    this.commuteEndTime = window.localStorage.getItem('commuteEndTime') || this.commuteEndTime;

    this.within = urlParams.has('within') ? urlParams.get('within') : this.defaultWithin;
    this.lasting = urlParams.has('lasting') ? Number.parseInt(urlParams.get('lasting')) : this.defaultLasting;
    this.startTime = urlParams.has('startTime') ? urlParams.get('startTime') : this.defaultStartTime;
    this.endTime = urlParams.has('endTime') ? urlParams.get('endTime') : this.defaultEndTime;
    this.address = urlParams.has('address') ? urlParams.get('address') : this.workAddress;

    this.showMoreSearchOptions = this.invite.length > 0 || this.startTime !== this.defaultStartTime || this.endTime !== this.defaultEndTime || this.address !== this.workAddress;

    // init pickers
    M.Datepicker.init(document.getElementById('after'), {
      setDefaultDate: true,
      minDate: new Date(),
      onClose: function(e) {
        app.searchFrom = this.date;
      }
    });

    var selects = document.querySelectorAll('select');
    selects.forEach(function(select) {
      var id = select.id;
      select.querySelectorAll('option').forEach(o => o.selected = app[id].toString() === o.value);
    });
    var formSelects = M.FormSelect.init(selects, {
      dropdownOptions: {
        constrainWidth: true,
        hover: false
      }
    });

    var collapsibles = document.querySelectorAll('.collapsible.expandable');
    M.Collapsible.init(collapsibles, {
      accordion: false
    });

    var invite = document.querySelectorAll('.chips');
    M.Chips.init(invite, {
      placeholder: 'Enter emails',
      data: this.invite.map(function(i) { return { tag: i }; })
    });

    var about = document.querySelectorAll('#about');
    M.Modal.init(about, {});

    var settings = document.querySelectorAll('#settings');
    M.Modal.init(settings, {
      onCloseEnd: function() {
        app.refresh();
      }
    });

    var tooltipped = document.querySelectorAll('.tooltipped');
    M.Tooltip.init(tooltipped);

    // var dropdowns = document.querySelectorAll('form .dropdown-trigger');
    // M.Dropdown.init(dropdowns, {
    //   constrainWidth: true,
    //   hover: false
    // });
    var dropdowns = document.querySelectorAll('nav .dropdown-trigger');
    M.Dropdown.init(dropdowns, {
      constrainWidth: false,
      hover: true
    });

    var timepickerOpts = {
      twelveHour: false,
      autoClose: true,
      container: '#manage'
    };
    M.Timepicker.init(document.querySelectorAll('#defaultStartTime'), {
      ...timepickerOpts,
      defaultTime: this.defaultStartTime,
      onCloseEnd: function() {
        app.defaultStartTime = this.time;
      }
    });
    M.Timepicker.init(document.querySelectorAll('#defaultEndTime'), {
      ...timepickerOpts,
      defaultTime: this.defaultEndTime,
      onCloseEnd: function() {
        app.defaultEndTime = this.time;
      }
    });
    M.Timepicker.init(document.querySelectorAll('#startTime'), {
      ...timepickerOpts,
      defaultTime: this.startTime,
      onCloseEnd: function() {
        app.startTime = this.time;
        app.refresh();
      }
    });
    M.Timepicker.init(document.querySelectorAll('#endTime'), {
      ...timepickerOpts,
      defaultTime: this.endTime,
      onCloseEnd: function() {
        app.endTime = this.time;
        app.refresh();
      }
    });
  },
  methods: {
    connect: function(e) {
      handleAuthClick(e);
    },
    disconnect: function(e) {
      handleSignoutClick(e);
    },
    refresh: function(e) {
      window.history.pushState({
        summary: this.summary,
        searchFromDate: moment(this.searchFromDate).format('YYYY-MM-DD'),
        lasting: this.lasting,
        within: this.within
      }, "", this.url);
      var dates = [];
      var searchToDate = moment(this.searchFromDate).add(moment.duration(this.within));
      var date = moment(this.searchFromDate);
      while (date.isSameOrBefore(searchToDate)) {
        if (date.day() !== 0 && date.day() !== 6) {
          dates.push(moment(date));
        }
        date.add({ day: 1 });
      }
      this.dates = dates;
    },
    addNextDaysEvents: function(e) {
      var lastDate = this.dates[this.dates.length - 1];
      var nextDate = moment(lastDate).add({ days: 1 });
      while (nextDate.day() === 0 || nextDate.day() === 6) { // Sunday or Saturday
        nextDate = moment(nextDate).add({ days: 1 });
      }
      this.dates = this.dates.concat([nextDate]);
    },
    addPreviousDaysEvents: function(e) {
      var firstDate = this.dates[0];
      var previousDate = moment(firstDate).subtract({ days: 1 });
      while (previousDate.day() === 0 || previousDate.day() === 6) { // Sunday or Saturday
        previousDate = moment(previousDate).subtract({ days: 1 });
      }
      this.dates = [previousDate].concat(this.dates);
    },
    getUserProfile: function() {
      var profile = gapi.auth2.getAuthInstance().currentUser.get().getBasicProfile();
      this.profile = {
        name: profile.getGivenName(),
        picture: profile.getImageUrl()
      };
    },
    getCalendar: function() {
      gapi.client.calendar.calendarList.get({
        'calendarId': 'primary'
      }).then(function(response) {
        app.calendar = response.result;
      });
    },
    getCalendarList: function() {
      gapi.client.calendar.calendarList.list().then(function(response) {
        var data = {};
        app.calendars = response.result.items.filter((cal) => cal.id.substr(-".calendar.google.com".length) !== ".calendar.google.com");
        app.calendars.forEach(function(cal) {
          if (cal.primary === undefined) {
            data[cal.id] = null
          }
        });
        var autocompleteOptions = {
          data: data,
          limit: Infinity,
          minLength: 1
        };
        var invite = document.querySelectorAll('.chips');
        var chips = M.Chips.init(invite, {
          placeholder: 'Enter emails',
          autocompleteOptions: autocompleteOptions,
          data: app.invite.map(function(i) { return { tag: i }; }),
          onChipAdd: function(els, b, c) {
            var data = els[0].M_Chips.chipsData.map((c) => c.tag);
            app.invite = data;
            app.ignore = app.ignore.filter((i) => app.invite.includes(i));
            app.refresh();
          },
          onChipDelete: function(els) {
            var data = els[0].M_Chips.chipsData.map((c) => c.tag);
            app.invite = data;
            app.ignore = app.ignore.filter((i) => app.invite.includes(i));
            app.refresh();
          }
        });
        chips[0].autocomplete.dropdown.options.constrainWidth = false;
      });
    },
    getHolds: function() {
      gapi.client.calendar.events.list({
        'calendarId': 'primary',
        'timeMin': (new Date()).toISOString(),
        'showDeleted': false,
        'singleEvents': true,
        'orderBy': 'startTime',
        'privateExtendedProperty': 'findtimesHolding=true'
      }).then(function(response) {
        var holding = [];
        var events = response.result.items;
        events.forEach(function(event) {
          var summary = event.summary;
          var id = event.id;
          var hold = holding.find((h) => h.summary === summary);
          if (hold) {
            hold.events.push(event);
          } else {
            holding.push({
              summary: summary,
              events: [event]
            });
          }
        });
        app.holding = holding;
      }, function(error) {
        console.log(error);
      });
    },
    updateTravelTimes: function(refresh = false) {
      var commuteDay = moment().startOf('week').add({ week: 1, days: 1 });
      if (this.address === "" || this.address === this.workAddress) {
        this.commuteToAddress = this.defaultStartTime;
        this.commuteFromAddress = this.defaultEndTime;
        this.travelToAddress = moment.duration(0);
        this.travelFromAddress = moment.duration(0);
        if (refresh) {
          app.refresh();
        }
      } else {
        if (this.homeAddress !== "") {
          var start = timeOnDay(commuteDay, this.commuteStartTime);
          var end = timeOnDay(commuteDay, this.commuteEndTime);
          // work out the earliest time could get to address
          calculateTravelTime({
            origins: [this.homeAddress],
            destinations: [this.address],
            travelMode: this.travelMode,
            departureTime: start.toDate()
          }, function(travelTimes) {
            if (travelTimes.length > 0) {
              var travelTime = travelTimes[0];
              app.checkHomeAddress = false;
              app.checkAddress = false;
              if (travelTime.origin === undefined) {
                app.invalidHomeAddress = true;
              } else if (travelTime.origin !== app.homeAddress) {
                app.homeAddress = travelTime.origin;
                app.invalidHomeAddress = false;
              }
              if (travelTime.destination === undefined) {
                app.invalidAddress = true;
              } else if (travelTime.destination !== app.address) {
                app.address = travelTime.destination;
                app.invalidAddress = false;
              }
              if (travelTime.duration) {
                app.commuteToAddress = timeOnDay(commuteDay, app.commuteStartTime).add(moment.duration(travelTime.duration)).endOf('minute').format('HH:mm');
              }
            }
            // work out latest time could leave address
            calculateTravelTime({
              destinations: [app.homeAddress],
              origins: [app.address],
              travelMode: app.travelMode,
              arrivalTime: end.toDate()
            }, function(travelTimes) {
              if (travelTimes.length > 0) {
                var travelTime = travelTimes[0];
                app.checkHomeAddress = false;
                app.checkAddress = false;
                if (travelTime.origin === undefined) {
                  app.invalidAddress = true;
                } else if (travelTime.origin !== app.Address) {
                  app.Address = travelTime.origin;
                  app.invalidAddress = false;
                }
                if (travelTime.destination === undefined) {
                  app.invalidHomeAddress = true;
                } else if (travelTime.destination !== app.homeAddress) {
                  app.homeAddress = travelTime.destination;
                  app.invalidHomeAddress = false;
                }
                if (travelTime.duration) {
                  app.commuteFromAddress = timeOnDay(commuteDay, app.commuteEndTime).subtract(moment.duration(travelTime.duration)).startOf('minute').format('HH:mm');
                }
              }
              if (refresh) {
                app.refresh();
              }
            });
          });
        }
        if (this.workAddress !== "") {
          // get a travel time outside rush hour based on middle of morning/afternoon
          var start = timeOnDay(commuteDay, "11:00");
          var end = timeOnDay(commuteDay, "15:00");
          // work out how long it takes to get from work to the address
          calculateTravelTime({
            origins: [this.workAddress],
            destinations: [this.address],
            travelMode: this.travelMode,
            arrivalTime: start.toDate()
          }, function(travelTimes) {
            if (travelTimes.length > 0) {
              var travelTime = travelTimes[0];
              app.checkWorkAddress = false;
              app.checkAddress = false;
              if (travelTime.origin === undefined) {
                app.invalidWorkAddress = true;
              } else if (travelTime.origin !== app.workAddress) {
                app.workAddress = travelTime.origin;
                app.invalidWorkAddress = false;
              }
              if (travelTime.destination === undefined) {
                app.invalidAddress = true;
              } else if (travelTime.destination !== app.address) {
                app.address = travelTime.destination;
                app.invalidAddress = false;
              }
              if (travelTime.duration) {
                app.travelToAddress = moment.duration(travelTime.duration);
              }
            }
            // work out latest time could leave address
            calculateTravelTime({
              destinations: [app.workAddress],
              origins: [app.address],
              travelMode: app.travelMode,
              departureTime: end.toDate()
            }, function(travelTimes) {
              if (travelTimes.length > 0) {
                var travelTime = travelTimes[0];
                app.checkWorkAddress = false;
                app.checkAddress = false;
                if (travelTime.origin === undefined) {
                  app.invalidAddress = true;
                } else if (travelTime.origin !== app.Address) {
                  app.Address = travelTime.origin;
                  app.invalidAddress = false;
                }
                if (travelTime.destination === undefined) {
                  app.invalidWorkAddress = true;
                } else if (travelTime.destination !== app.workAddress) {
                  app.workAddress = travelTime.destination;
                  app.invalidWorkAddress = false;
                }
                if (travelTime.duration) {
                  app.travelFromAddress = moment.duration(travelTime.duration);
                }
              }
              if (refresh) {
                app.refresh();
              }
            });
          });
        }
      }
    },
    updateCommuteTimes: function() {
      if (this.homeAddress !== "" && this.workAddress !== "") {
        var commuteDay = moment().startOf('week').add({ 'week': 1, 'days': 1 });
        var start = timeOnDay(commuteDay, this.defaultStartTime);
        var end = timeOnDay(commuteDay, this.defaultEndTime);
        calculateTravelTime({
          origins: [this.homeAddress],
          destinations: [this.workAddress],
          travelMode: this.travelMode,
          arrivalTime: start.toDate()
        }, function(travelTimes) {
          if (travelTimes.length > 0) {
            var travelTime = travelTimes[0];
            app.checkHomeAddress = false;
            app.checkWorkAddress = false;
            if (travelTime.origin === undefined) {
              app.invalidHomeAddress = true;
            } else if (travelTime.origin !== app.homeAddress) {
              app.homeAddress = travelTime.origin;
              app.invalidHomeAddress = false;
            }
            if (travelTime.destination === undefined) {
              app.invalidWorkAddress = true;
            } else if (travelTime.destination !== app.workAddress) {
              app.workAddress = travelTime.destination;
              app.invalidWorkAddress = false;
            }
            if (travelTime.duration) {
              app.commuteStartTime = moment(start).subtract(moment.duration(travelTime.duration)).startOf('minute').format('HH:mm');
            }
          }
        });
        calculateTravelTime({
          destinations: [this.homeAddress],
          origins: [this.workAddress],
          travelMode: this.travelMode,
          departureTime: end.toDate()
        }, function(travelTimes) {
          if (travelTimes.length > 0) {
            var travelTime = travelTimes[0];
            app.checkHomeAddress = false;
            app.checkWorkAddress = false;
            if (travelTime.origin === undefined) {
              app.invalidWorkAddress = true;
            } else if (travelTime.origin !== app.workAddress) {
              app.workAddress = travelTime.origin;
              app.invalidWorkAddress = false;
            }
            if (travelTime.destination === undefined) {
              app.invalidHomeAddress = true;
            } else if (travelTime.destination !== app.homeAddress) {
              app.homeAddress = travelTime.destination;
              app.invalidHomeAddress = false;
            }
            if (travelTime.duration) {
              app.commuteEndTime = moment(end).add(moment.duration(travelTime.duration)).startOf('minute').add({ minutes: 1 }).format('HH:mm');
            }
          }
        });
      }
    },
    updateEventViews: function(event) {
      var date = moment(event.start.dateTime).startOf('day');
      // refresh the day containing the event that's been updated
      var dayExpandableComponent = this.$root.$children.find((c) => c.date && c.date.isSame(date));
      if (dayExpandableComponent) {
        // propagate the update so this is also updated
        dayExpandableComponent.refresh(true);
      }
    },
    ignoreInvite: function(calendarId) {
      if (!this.ignore.includes(calendarId)) {
        this.ignore.push(calendarId);
        M.toast({
          html: "Couldn't load calendar for " + calendarId
        });
      }
    },
    setValueFromSelect: function(e) {
      var prop = e.target.id;
      this[prop] = e.target.value;
      this.refresh();
    }
  }
});
