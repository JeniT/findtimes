/* global gapi */
/* global Vue */
/* global moment */
/* global M */
/* global URL */

// Client ID and API key from the Developer Console
var CLIENT_ID = '580782451843-b14d0fq1lu5a6ag1qldg4imfbjb00dtg.apps.googleusercontent.com';
var API_KEY = 'AIzaSyBJgCluChiRKeB21y2zqsxdELyZrxMmmGM';

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

var APP_NAME = "find times";
var APP_URL = "https://findtim.es/";
var APP_SLOT_KIND = APP_NAME.toLowerCase() + "#slot";
var HOLD_PREFIX = "[HOLD] ";

/**
 *  On load, called to load the auth2 library and API client library.
 */
function handleClientLoad() {
  gapi.load('client:auth2', initClient);

  // init pickers
  M.Datepicker.init(document.getElementById('after'), {
    setDefaultDate: true,
    onClose: function(e) {
      app.searchFrom = this.date;
    }
  });

  var selects = document.querySelectorAll('select');
  var formSelects = M.FormSelect.init(selects, {
    dropdownOptions: {
      constrainWidth: false,
      hover: false
    }
  });

  var collapsibles = document.querySelectorAll('.collapsible.expandable');
  M.Collapsible.init(collapsibles, {
    accordion: false
  });
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

function fetchCalendarEvents(calendarIds, start, end, success, error, events = []) {
  if (calendarIds.length === 0) {
    return success.call(this, events);
  }
  var calendarId = calendarIds.pop();
  if (!app.ignore.includes(calendarId)) {
    return gapi.client.calendar.events.list({
      'calendarId': calendarId,
      'timeMin': start.toISOString(),
      'timeMax': end.toISOString(),
      'showDeleted': false,
      'singleEvents': true,
      'orderBy': 'startTime'
    }).then(function(response) {
      var es = response.result.items;
      es.forEach(function(e) { e.calendarId = calendarId; return e; })
      events = events.concat(es);
      fetchCalendarEvents(calendarIds, start, end, success, error, events);
    }, function(response) {
      error.call(this, calendarId, response);
      fetchCalendarEvents(calendarIds, start, end, success, error, events);
    });
  } else {
    return fetchCalendarEvents(calendarIds, start, end, success, error, events);
  }
}

function sortEvents(e1, e2) {
  var start1 = e1.start.dateTime || (e1.start.date + "T00:00:00");
  var start2 = e2.start.dateTime || (e2.start.date + "T00:00:00");
  var end1 = e1.end.dateTime || (e1.end.date + "T00:00:00");
  var end2 = e2.end.dateTime || (e2.end.date + "T00:00:00");
  var id1 = e1.id;
  var id2 = e2.id;
  if (start1 < start2) {
    return -1;
  } else if (start1 > start2) {
    return 1;
  } else if (end1 < end2) {
    return -1;
  } else if (end1 > end2) {
    return 1;
  } else if (id1 < id2) {
    return -1;
  } else if (id1 > id2) {
    return 1;
  } else {
    return 0;
  }
}

function addSlotsBetween(start, end, duration, events, eventIndex = 0) {
  var eventStarts, eventEnds;
  var attending = "accepted";
  if (events.length > eventIndex) {
    eventStarts = events[eventIndex].start.dateTime || (events[eventIndex].start.date + "T00:00:00");
    eventEnds = events[eventIndex].end.dateTime || (events[eventIndex].end.date + "T00:00:00");
    if (events[eventIndex].attendees) {
      var ownAttendance = events[eventIndex].attendees.find(attendee => attendee.self);
      attending = ownAttendance === undefined ? "accepted" : ownAttendance.responseStatus;
    }
  } else {
    eventStarts = end;
  }
  var slotEnds = moment(start).add({ minutes: duration });
  if (slotEnds.isAfter(end)) {
    return events;
  } else if (events.length > eventIndex &&
    (events[eventIndex].transparency == "transparent" ||
      attending == "declined" ||
      start.isAfter(eventEnds))) {
    return addSlotsBetween(start, end, duration, events, eventIndex + 1);
  } else if (slotEnds.isAfter(eventStarts)) {
    if (moment(eventEnds).isAfter(end)) {
      return events;
    } else {
      return addSlotsBetween(moment(eventEnds), end, duration, events, eventIndex + 1);
    }
  } else {
    var slot = {
      kind: APP_SLOT_KIND,
      id: Math.random().toString().replace('.', ''),
      hold: true,
      start: { dateTime: start.toISOString() },
      end: { dateTime: slotEnds.toISOString() }
    };
    events.splice(eventIndex, 0, slot);
    return addSlotsBetween(slotEnds, end, duration, events, eventIndex + 1);
  }
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
    var modals = document.querySelectorAll('.modal');
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
          <div v-if="loading">
            <div class="progress"><div class="indeterminate"></div></div>
          </div>
          <div v-else>
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
    }
  },
  methods: {
    refresh: function(propagate = true) {
      var startTime = app.startTime.split(':').map(i => Number.parseInt(i));
      var endTime = app.endTime.split(':').map(i => Number.parseInt(i));
      var start = moment(this.date).startOf('day').add({ hours: startTime[0], minutes: startTime[1] });
      var end = moment(this.date).startOf('day').add({ hours: endTime[0], minutes: endTime[1] });
      var duration = app.lasting;
      var dayExpandable = this;
      fetchCalendarEvents(app.invite.concat(['primary']), start, end, function(events) {
        dayExpandable.error = false;
        events = events.sort(sortEvents);
        events = events.filter(function(e, i) { if ((i == 0) || (events[i - 1].id !== e.id)) return e; });
        dayExpandable.events = addSlotsBetween(start, end, duration, events).sort(sortEvents);
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
    allDay: function() {
      return this.event.start.dateTime === undefined;
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
        people = this.event.attendees.find(attendee => (!ownEvent || !attendee.self) && !attendee.resource);
      } else if (!this.ownEvent) {
        people = [{
          email: this.event.calendarId
        }];
      }
      return people;
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
      if (!this.isSlot) {
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
          classes[this.color] = true;
        }
      }
      classes[this.attending] = true;
      classes["transparent"] = this.event.transparency == "transparent";
      classes["slot"] = this.isSlot;
      return classes;
    },
    dateClasses: function() {
      var classes = {};
      if (!this.isSlot) {
        if (!this.ownEvent) {
          classes = {
            'blue-grey-text': true,
            'text-lighten-3': true
          }
        } else {
          classes[this.color + "-text"] = true;
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
    }
  },
  mounted: function() {
    var dropdowns = document.querySelectorAll('.dropdown-trigger');
    M.Dropdown.init(dropdowns, {
      constrainWidth: false,
      hover: true
    });
  },
  methods: {
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
          currentEvent.extendedProperties.private.findtimesInvite.split(',').forEach(function (invitee) {
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
    hold: function() {
      var event = this;
      var holdEvent = {
        calendarId: 'primary',
        summary: "[HOLD] " + (app.newEventSummary || "reserved"),
        start: this.event.start,
        end: this.event.end,
        status: "tentative",
        extendedProperties: {
          'private': {
            findtimesHolding: true,
            findtimesInvite: app.invite.join(',')
          }
        }
      };
      gapi.client.calendar.events.insert(holdEvent).then(function(response) {
        event.$emit('updated', event.event);
      }, function(error) {
        console.log(error);
      });
    },
    book: function() {
      var event = this;
      var bookEvent = {
        calendarId: 'primary',
        summary: (app.newEventSummary || "reserved"),
        start: this.event.start,
        end: this.event.end,
        status: "confirmed",
      };
      var attendees = [];
      var conferenceSolutionType = app.ownCalendar.conferenceProperties.allowedConferenceSolutionTypes[0];
      if (app.invite.length > 0) {
        app.invite.forEach(function (invitee) {
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
      <div v-if="isSlot">
        <div class="secondary-content">
          <a href="" class="btn-flat amber white-text waves-effect waves-light" v-on:click.prevent="hold">Hold</a>
          <a href="" class="btn-flat teal white-text waves-effect waves-light" v-on:click.prevent="book">Book</a>
        </div>
        <span class="title">Available</span>
        <br />
        <span class="grey-text">{{formattedDate}}</span>
      </div>
      <div v-else>
        <div v-if="ownEvent" class="secondary-content">
          <a class='dropdown-trigger btn-flat' v-bind:class="classes" href='#' v-bind:data-target='context + "edit" + event.id'>
            <i class="material-icons">more_vert</i>
          </a>
          <ul v-bind:id='context + "edit" + event.id' class='dropdown-content'>
            <li><a v-bind:href="event.htmlLink" target="_new"><i class="material-icons">open_in_new</i>View</a></li>
            <li v-if="holding">
              <a href="" v-on:click.prevent="confirm"><i class="material-icons">event_available</i>Confirm</a>
            </li>
            <li v-if="event.attendees !== undefined">
              <a v-if="attending != 'accepted'" href=""><i class="material-icons">event_available</i>Accept</a>
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
  newEventSummary: "",
  searchFromDate: moment().startOf('day').add({ days: 1 }),
  lasting: 60,
  within: 'P2W',
  invite: [],
  startTime: "09:30",
  endTime: "17:00"
};
var app = new Vue({
  el: '#app',
  data: {
    dates: [],
    connected: false,
    calendar: {},
    newEventSummary: urlParams.has('summary') ? urlParams.get('summary') : searchDefaults.newEventSummary,
    searchFromDate: urlParams.has('after') ? moment(urlParams.get('after')).startOf('day') : searchDefaults.searchFromDate,
    lasting: urlParams.has('lasting') ? Number.parseInt(urlParams.get('lasting')) : this.defaultLasting,
    within: searchDefaults.within,
    invite: urlParams.has('invite') ? (urlParams.get('invite') === "" ? [] : urlParams.get('invite').split(",")) : searchDefaults.invite,
    ignore: [], // people on the invite list to ignore when fetching calendars (because you don't have access)
    startTime: searchDefaults.startTime,
    endTime: searchDefaults.endTime,
    holding: [],
    calendars: [],
    profile: {},
    showMoreSearchOptions: false
  },
  computed: {
    defaultWithin: {
      get: function() {
        return window.localStorage.getItem('defaultWithin') || searchDefaults.within;
      },
      set: function(value) {
        var oldValue = window.localStorage.getItem('defaultWithin') || searchDefaults.within;
        window.localStorage.setItem('defaultWithin', value);
        if (this.within === oldValue) {
          this.within = value;
        }
      }
    },
    defaultLasting: {
      get: function() {
        return window.localStorage.getItem('defaultLasting') ? Number.parseInt(window.localStorage.getItem('defaultLasting')) : searchDefaults.lasting;
      },
      set: function(value) {
        var oldValue = Number.parseInt(window.localStorage.getItem('defaultLasting')) || searchDefaults.lasting;
        window.localStorage.setItem('defaultLasting', value);
        if (this.lasting === oldValue) {
          this.lasting = value;
        }
      }
    },
    defaultStartTime: {
      get: function() {
        return window.localStorage.getItem('defaultStartTime') || searchDefaults.startTime;
      },
      set: function(value) {
        var oldValue = window.localStorage.getItem('defaultStartTime') || searchDefaults.startTime;
        window.localStorage.setItem('defaultStartTime', value);
        if (this.startTime === oldValue) {
          this.startTime = value;
        }
      }
    },
    defaultEndTime: {
      get: function() {
        return window.localStorage.getItem('defaultEndTime') || searchDefaults.endTime;
      },
      set: function(value) {
        var oldValue = window.localStorage.getItem('defaultEndTime') || searchDefaults.endTime;
        window.localStorage.setItem('defaultEndTime', value);
        if (this.endTime === oldValue) {
          this.endTime = value;
        }
      }
    },
    ownCalendar: function() {
      return this.calendars.find((c) => c.primary === true);
    },
    ownEmail: function() {
      return this.ownCalendar.id;
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
        return params.length > 0 ? ("?" + params.join('&')) : "";
      },
      set: function(url) {
        var urlParams = new URL(url).searchParams;
        this.newEventSummary = urlParams.has('summary') ? urlParams.get('summary') : searchDefaults.summary;
        this.searchFromDate = urlParams.has('after') ? moment(urlParams.get('after')).startOf('day') : searchDefaults.searchFromDate;
        this.lasting = urlParams.has('lasting') ? Number.parseInt(urlParams.get('lasting')) : this.defaultLasting;
        this.within = urlParams.has('within') ? moment.duration(urlParams.get('within')) : this.defaultWithin;
        this.invite = urlParams.has('invite') ? urlParams.get('invite').split(",") : searchDefaults.invite;
        this.startTime = urlParams.has('startTime') ? urlParams.get('startTime') : this.defaultStartTime;
        this.endTime = urlParams.has('endTime') ? urlParams.get('endTime') : this.defaultEndTime;
      }
    }
  },
  watch: {
    searchFromDate: function(oldDate, newDate) {
      this.refresh();
    }
  },
  mounted: function() {
    this.within = urlParams.has('within') ? urlParams.get('within') : this.defaultWithin;
    this.lasting = urlParams.has('lasting') ? Number.parseInt(urlParams.get('lasting')) : this.defaultLasting;
    this.startTime = urlParams.has('startTime') ? urlParams.get('startTime') : this.defaultStartTime;
    this.endTime = urlParams.has('endTime') ? urlParams.get('endTime') : this.defaultEndTime;
    
    var invite = document.querySelectorAll('.chips');
    M.Chips.init(invite, {
      placeholder: 'Enter emails',
      data: this.invite.map(function(i) { return { tag: i }; })
    });
    var modals = document.querySelectorAll('#settings');
    M.Modal.init(modals, {
      onCloseEnd: function() {
        app.refresh();
      }
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
        newEventSummary: this.newEventSummary,
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
