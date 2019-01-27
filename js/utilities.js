/* global app */
/* global moment */
/* global mapsService */
/* global gapi */

var APP_NAME = "find times";
var APP_URL = "https://findtim.es/";

var APP_SLOT_KIND = APP_NAME.replace(' ', '').toLowerCase() + "#slot";
var APP_TRAVEL_KIND = APP_NAME.replace(' ', '').toLowerCase() + "#travel";

function calculateTravelTime(options, callback) {
  var cachedTravelTimes = window.localStorage.getItem('cachedTravelTimes');
  var placeAliases = window.localStorage.getItem('placeAliases');
  var badPlaces = window.localStorage.getItem('badPlaces');
  cachedTravelTimes = cachedTravelTimes ? JSON.parse(cachedTravelTimes) : [];
  placeAliases = placeAliases ? JSON.parse(placeAliases) : {};
  badPlaces = badPlaces ? JSON.parse(badPlaces) : [];

  options.origins = options.origins.filter(o => !badPlaces.includes(o));
  options.destinations = options.destinations.filter(o => !badPlaces.includes(o));
  if (options.origins.length === 0 || options.destinations.length === 0) {
    return callback.call(this, []);
  }

  var origins = options.origins.map(o => [o].concat(placeAliases[o]) || [o]);
  var destinations = options.destinations.map(d => [d].concat(placeAliases[d]) || [d]);
  var arrivalDayTime = options.arrivalTime ? moment(options.arrivalTime).format('ddd HH:mm') : undefined;
  var departureDayTime = options.departureTime ? moment(options.departureTime).format('ddd HH:mm') : undefined;
  var travelMode = options.travelMode || app.travelMode;

  var travelTimes = [];
  origins.forEach(originAliases =>
    destinations.forEach(function(destinationAliases) {
      // assume that travelling between the same two places at the same time 
      // on any day of the week will result in the same length travel
      var cachedTravelTime = cachedTravelTimes.find(t =>
        originAliases.find(o => t.origin === o) && destinationAliases.find(d => t.destination === d) &&
        t.mode === travelMode &&
        (arrivalDayTime ? t.arrivalDayTime === arrivalDayTime : t.departureDayTime === departureDayTime)
      );
      if (cachedTravelTime) {
        travelTimes.push(cachedTravelTime);
      }
    })
  );

  if (travelTimes.length === options.origins.length * options.destinations.length) {
    callback.call(this, travelTimes);
  } else if (mapsService) {
    mapsService.getDistanceMatrix({
      origins: options.origins,
      destinations: options.destinations,
      travelMode: travelMode.toUpperCase(),
      transitOptions: {
        arrivalTime: moment(options.arrivalTime).toDate(),
        departureTime: moment(options.departureTime).toDate()
      },
    }, function(response) {
      if (!response) {
        console.log('null response to travel time request');
        console.log(options);
        return callback.call(this, []);
      }

      var placeAliases = window.localStorage.getItem('placeAliases');
      placeAliases = placeAliases ? JSON.parse(placeAliases) : {};
      var badPlaces = window.localStorage.getItem('badPlaces');
      badPlaces = badPlaces ? JSON.parse(badPlaces) : [];

      if (response.rows.every(row => row.elements.every(element => element.status === "ZERO_RESULTS"))) {
        if (options.origins.length === 1) {
          if (!badPlaces.includes(options.origins[0])) {
            badPlaces.push(options.origins[0]);
          }
        }
        if (options.destinations.length === 1) {
          if (!badPlaces.includes(options.destinations[0])) {
            badPlaces.push(options.destinations[0]);
          }
        }
      }

      response.originAddresses.forEach(function(responseAddress, i) {
        var requestAddress = options.origins[i];
        var aliases = placeAliases[requestAddress];
        if (responseAddress === "") {
          badPlaces.push(requestAddress);
        } else if (responseAddress !== requestAddress) {
          if (aliases) {
            if (!aliases.includes(responseAddress)) {
              aliases.push(responseAddress);
            }
          } else {
            placeAliases[requestAddress] = [responseAddress];
          }
        }
      });
      response.destinationAddresses.forEach(function(responseAddress, i) {
        var requestAddress = options.destinations[i];
        var aliases = placeAliases[requestAddress];
        if (responseAddress === "") {
          badPlaces.push(requestAddress);
        } else if (responseAddress !== requestAddress) {
          if (aliases) {
            if (!aliases.includes(responseAddress)) {
              aliases.push(responseAddress);
            }
          } else {
            placeAliases[requestAddress] = [responseAddress];
          }
        }
      });
      window.localStorage.setItem('placeAliases', JSON.stringify(placeAliases));
      window.localStorage.setItem('badPlaces', JSON.stringify(badPlaces));

      var cachedTravelTimes = window.localStorage.getItem('cachedTravelTimes');
      if (cachedTravelTimes) {
        cachedTravelTimes = JSON.parse(cachedTravelTimes);
      } else {
        cachedTravelTimes = [];
      }

      response.originAddresses.forEach(function(origin, i) {
        response.destinationAddresses.forEach(function(destination, j) {
          var element = response.rows[i].elements[j];
          var travelTime = {
            updated: new Date(),
            origin: origin,
            destination: destination,
            mode: travelMode,
          };
          if (element.status === "OK") {
            travelTime = {
              ...travelTime,
              duration: moment.duration(element.duration.value, 'seconds')
            }
            if (arrivalDayTime) {
              travelTime['arrivalDayTime'] = arrivalDayTime;
            } else if (departureDayTime) {
              travelTime['departureDayTime'] = departureDayTime;
            }
            cachedTravelTimes.unshift(travelTime);
          } else if (element.status === "NOT_FOUND") {
            travelTime = {
              ...travelTime,
              origin: origin === "" ? undefined : origin,
              destination: destination === "" ? undefined : destination
            };
            cachedTravelTimes.unshift(travelTime);
          } else {
            console.log(response);
            cachedTravelTimes.unshift(travelTime);
          }
          travelTimes.push(travelTime);
        });
      });
      var weekAgo = moment().subtract({ weeks: 1 });
      cachedTravelTimes = cachedTravelTimes.filter(t => moment(t.updated).isAfter(weekAgo));
      window.localStorage.setItem('cachedTravelTimes', JSON.stringify(cachedTravelTimes));
      callback.call(this, travelTimes);
    });
  } else {
    return travelTimes;
  }
}

function eventLocation(event) {
  if (event.attendees && event.attendees.find(attendee => attendee.resource)) {
    return app.workAddress;
  } else {
    return event.location || event.origin || app.workAddress;
  }
}

function originalAddresses(address) {
  var placeAliases = window.localStorage.getItem('placeAliases');
  placeAliases = placeAliases ? JSON.parse(placeAliases) : {};
  return Object.keys(placeAliases).filter(original => placeAliases[original].includes(address)).concat([address]);
}

function fetchEventTravel(events, places, success, index = 0) {
  var otherPlaces;
  if (events.length <= index) {
    return success.call(this, events);
  }
  var event = events[index];
  if (event.start.dateTime) {
    var eventAddress = eventLocation(event);
    if (eventAddress !== app.workAddress) {
      otherPlaces = places.filter(p => p !== eventAddress);
      calculateTravelTime({
        origins: otherPlaces,
        destinations: [eventAddress],
        arrivalTime: event.start.dateTime
      }, function(travelTo) {
        if (travelTo) {
          event.travelTo = travelTo.map(function(t) {
            if (t && t.origin && t.duration) {
              return {
                origin: t.origin,
                leave: moment(event.start.dateTime).subtract(moment.duration(t.duration))
              };
            }
          });
        }
        calculateTravelTime({
          origins: [eventAddress],
          destinations: otherPlaces,
          departureTime: event.end.dateTime
        }, function(travelFrom) {
          if (travelFrom) {
            event.travelFrom = travelFrom.map(function(t) {
              if (t && t.destination && t.duration) {
                return {
                  destination: t.destination,
                  arrive: moment(event.end.dateTime).add(moment.duration(t.duration))
                }
              }
            });
          }
          fetchEventTravel(events, places, success, index + 1);
        });
      });
      return;
    }
  }
  fetchEventTravel(events, places, success, index + 1);
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
      es.forEach(e => e.calendarId = calendarId);
      if (calendarId === 'primary') {
        var places = es.map(e => eventLocation(e));
        if (!places.includes(app.workAddress)) places.push(app.workAddress);
        if (!places.includes(app.homeAddress)) places.push(app.homeAddress);
        if (!places.includes(app.address)) places.push(app.address);
        places = places.filter(p => p !== "");
        places = places.sort();
        places = places.filter((p, i) => i === 0 || places[i - 1] !== p);
        fetchEventTravel(es, places, function(es) {
          events = events.concat(es);
          fetchCalendarEvents(calendarIds, start, end, success, error, events);
        });
      } else {
        events = events.concat(es);
        fetchCalendarEvents(calendarIds, start, end, success, error, events);
      }
    }, function(response) {
      error.call(this, calendarId, response);
      fetchCalendarEvents(calendarIds, start, end, success, error, events);
    });
  } else {
    return fetchCalendarEvents(calendarIds, start, end, success, error, events);
  }
}

function sortEvents(e1, e2) {
  var start1 = moment(e1.start.dateTime || (e1.start.date + "T00:00:00")).toISOString();
  var start2 = moment(e2.start.dateTime || (e2.start.date + "T00:00:00")).toISOString();
  var end1 = moment(e1.end.dateTime || (e1.end.date + "T00:00:00")).toISOString();
  var end2 = moment(e2.end.dateTime || (e2.end.date + "T00:00:00")).toISOString();
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
  } else if (e1.calendarId === 'primary') {
    return -1;
  } else if (e2.calendarId === 'primary') {
    return 1;
  } else {
    return 0;
  }
}

function timeOnDay(day, time) {
  var time = time.split(':').map(i => Number.parseInt(i));
  return moment(day).startOf('day').add({ hours: time[0], minutes: time[1] });
}

function eventOwnAttendance(event) {
  if (event.attendees) {
    return event.attendees.find(attendee => attendee.self);
  } else {
    return undefined;
  }
}

function eventAttending(event) {
  var attending = "accepted";
  var ownAttendance = eventOwnAttendance(event);
  if (event.attendees) {
    attending = ownAttendance !== undefined ? ownAttendance.responseStatus : "accepted";
  } else if (!event.calendarId === 'primary') {
    return "other";
  }
  return attending;
}

function eventPriority(event) {
  if (event.extendedProperties &&
    event.extendedProperties.private &&
    event.extendedProperties.private.findtimesPriority) {
    return Number.parseInt(event.extendedProperties.private.findtimesPriority);
  } else if (event.transparency === "transparent") {
    return 5;
  } else {
    var attending = eventAttending(event);
    if (attending === "needsAction") {
      var ownAttendance = eventOwnAttendance(event);
      return ownAttendance && ownAttendance.optional ? app.defaultOptionalPriority : app.defaultNeedsActionPriority;
    } else if (attending === "tentative") {
      return 3;
    } else {
      return 1;
    }
  }
}

function addSlotsBetween(start, end, duration, startAddress, events, eventIndex = 0) {
  var eventStarts, eventEnds, eventAddress;
  var morningCommute = false;
  var eveningCommute = false;
  var attending = "accepted";
  var workStarts = timeOnDay(start, app.defaultStartTime);
  var workEnds = timeOnDay(start, app.defaultEndTime);
  var priority = 1;
  if (start.isSameOrAfter(end)) {
    return events;
  }
  if (events.length > eventIndex) {
    eventStarts = events[eventIndex].start.dateTime || (events[eventIndex].start.date + "T00:00:00");
    eventEnds = events[eventIndex].end.dateTime || (events[eventIndex].end.date + "T00:00:00");
    eventAddress = eventLocation(events[eventIndex]);
    priority = eventPriority(events[eventIndex]);
    attending = eventAttending(events[eventIndex]);
    // if (start.isAfter(eventStarts)) {
    //   return addSlotsBetween(start, end, duration, eventAddress, events, eventIndex + 1);
    // }
    if (events[eventIndex].attendees) {
      if (events[eventIndex].attendees.find(attendee => attendee.resource)) {
        eventAddress = app.workAddress;
      }
    }
    // skip / ignore events we're not attending or that are lower priority than this one
    if (events[eventIndex].transparency === "transparent" ||
      attending === "declined" ||
      start.isAfter(eventEnds) ||
      priority > app.priority) {
      return addSlotsBetween(start, end, duration, startAddress, events, eventIndex + 1);
    }
    if (startAddress === app.homeAddress && eventAddress === app.workAddress && start.format('HH:mm') === app.commuteStartTime) {
      morningCommute = true;
    }
  } else {
    // rest of the day is free but have to get home
    eventStarts = end;
    eventAddress = app.homeAddress; // where you want to end up
    eveningCommute = true;
  }
  var slotEvents = [];
  var slotTravelToEnds = start;
  if (app.address !== startAddress) {
    if (eventIndex > 0 && events[eventIndex - 1].travelFrom) {
      var travelFrom = events[eventIndex - 1].travelFrom.find(t => originalAddresses(t.destination).includes(app.address));
      if (travelFrom) {
        slotTravelToEnds = travelFrom.arrive;
      } else if (startAddress === app.workAddress) {
        slotTravelToEnds = moment(start).add(app.travelToAddress);
      }
    } else if (startAddress === app.homeAddress && app.homeAddress !== "") {
      slotTravelToEnds = timeOnDay(start, app.commuteToAddress);
    } else if (startAddress === app.workAddress && app.workAddress !== "") {
      slotTravelToEnds = moment(start).add(app.travelToAddress);
    }
    if (!slotTravelToEnds.isSame(start)) {
      slotEvents.push({
        kind: APP_TRAVEL_KIND,
        id: Math.random().toString().replace('.', ''),
        travel: true,
        origin: startAddress,
        destination: app.address,
        start: { dateTime: start },
        end: { dateTime: slotTravelToEnds },
        mode: app.travelMode
      });
    }
  }
  if (slotTravelToEnds.isAfter(end)) {
    // jump to adding commute events
  } else if (slotTravelToEnds.isBefore(eventStarts)) {
    var slotStarts = moment(slotTravelToEnds);
    if (slotStarts.second() !== 0) slotStarts.second(60); // moment helpfully bubbles this up to the minute
    if (slotStarts.minute() % 15) {
      if (slotStarts.minute() < 15) {
        slotStarts.minute(15);
      } else if (slotStarts.minute() < 30) {
        slotStarts.minute(30);
      } else if (slotStarts.minute() < 45) {
        slotStarts.minute(45);
      } else {
        slotStarts.minute(60); // moment helpfully bubbles this up to the hour
      }
    }
    var earliestSlotEnds = moment(slotStarts).add({ minutes: duration });
    var slotEnds = moment(earliestSlotEnds);
    if (slotEnds.isAfter(end) || slotEnds.isAfter(timeOnDay(start, app.commuteFromAddress))) {
      // jump to creating commute events
    } else if (slotEnds.isSameOrBefore(eventStarts)) {
      var slot = {
        kind: APP_SLOT_KIND,
        id: Math.random().toString().replace('.', ''),
        hold: true,
        start: { dateTime: slotStarts },
        end: { dateTime: slotEnds },
        location: app.address
      }
      // before pushing the slot, check whether you can make it to the next event
      // don't have to work out exactly how you're going to get there yet;
      // that'll be handled by the standard travel-adding code, just whether there's
      // time to get there
      var canMakeItToNextEvent = false;
      if (eventAddress === app.address || app.address === "") {
        canMakeItToNextEvent = true;
        slotEnds = moment(eventStarts);
      } else if (eventAddress === app.homeAddress && app.homeAddress !== "") {
        canMakeItToNextEvent = slotEnds.isSameOrBefore(timeOnDay(start, app.commuteFromAddress));
        slotEnds = timeOnDay(start, app.commuteFromAddress);
      } else if (eventAddress === app.workAddress && app.workAddress !== "") {
        canMakeItToNextEvent = (slotEnds).add(app.travelFromAddress).isSameOrBefore(eventStarts);
        slotEnds = (slotEnds).add(app.travelFromAddress);
      } else if (events.length > 0 && events[eventIndex].travelTo) {
        var travelFromAddress = events[eventIndex].travelTo.find(t => originalAddresses(t.origin).includes(app.address));
        if (travelFromAddress) {
          canMakeItToNextEvent = slotEnds.isSameOrBefore(travelFromAddress.leave);
          slotEnds = travelFromAddress.leave;
        } else {
          canMakeItToNextEvent = true; // assume you can travel instantaneously
          slotEnds = moment(eventStarts);
        }
      }
      if (slotEnds.second() !== 0) slotStarts.second(0);
      if (slotEnds.minute() % 15) {
        if (slotEnds.minute() < 15) {
          slotEnds.minute(0);
        } else if (slotEnds.minute() < 30) {
          slotEnds.minute(15);
        } else if (slotEnds.minute() < 45) {
          slotEnds.minute(30);
        } else {
          slotEnds.minute(45);
        }
      }
      if (canMakeItToNextEvent && slotEnds.isSameOrAfter(earliestSlotEnds)) {
        slot.end.dateTime = slotEnds;
        slotEvents.push(slot);
        slotEvents.forEach((e, i) => events.splice(eventIndex + i, 0, e));
        return addSlotsBetween(moment(slotEnds), end, duration, app.address, events, eventIndex + slotEvents.length);
      }
    }
  }
  if (events.length <= eventIndex && startAddress === app.homeAddress && app.homeAddress !== "") {
    // this happens if there are no events all day; should go to work regardless
    eventStarts = workStarts;
    eventAddress = app.workAddress;
    morningCommute = true;
  }
  if (startAddress !== "" && eventAddress !== "" && startAddress !== eventAddress) {
    var travelTo;
    // add some travel
    var travel = {
      kind: APP_TRAVEL_KIND,
      id: Math.random().toString().replace('.', ''),
      travel: true,
      origin: startAddress,
      destination: eventAddress
    };
    if (morningCommute) {
      travel = {
        ...travel,
        start: { dateTime: start },
        end: { dateTime: workStarts },
        mode: app.travelMode
      }
      events.splice(eventIndex, 0, travel);
      return addSlotsBetween(moment(travel.end.dateTime), end, duration, app.workAddress, events, eventIndex + 1);
    } else if (eveningCommute) {
      // eventAddress is always app.homeAddress
      if (startAddress === app.workAddress && app.workAddress !== "") {
        travel = {
          ...travel,
          start: { dateTime: workEnds },
          end: { dateTime: end },
          mode: app.travelMode
        }
        events.splice(eventIndex, 0, travel);
        // maybe do something before commuting
        return addSlotsBetween(start, end, duration, startAddress, events, eventIndex);
      } else if (startAddress === app.address) {
        travel = {
          ...travel,
          start: { dateTime: timeOnDay(start, app.commuteFromAddress) },
          end: { dateTime: end },
          mode: app.travelMode
        }
        events.splice(eventIndex, 0, travel);
        // maybe do something before commuting
        return addSlotsBetween(start, end, duration, startAddress, events, eventIndex);
      } else {
        if (eventIndex > 0 && events[eventIndex - 1].travelFrom) {
          var toHome = events[eventIndex - 1].travelFrom.find(t => t.destination === app.homeAddress);
          var toWork = events[eventIndex - 1].travelFrom.find(t => t.destination === app.workAddress);
          if (toWork && moment(toWork.arrive).isSameOrAfter(workEnds)) {
            // no point going back to work, go straight home
            travel = {
              ...travel,
              destination: app.homeAddress,
              start: { dateTime: workEnds },
              end: { dateTime: end },
              mode: app.travelMode
            }
            events.splice(eventIndex, 0, travel);
            // maybe do something before going home
            return addSlotsBetween(start, end, duration, startAddress, events, eventIndex);
          } else {
            // go back to work first
            travel = {
              ...travel,
              destination: app.workAddress,
              start: { dateTime: start },
              end: { dateTime: toWork.arrive },
              mode: app.travelMode
            }
            events.splice(eventIndex, 0, travel);
            return addSlotsBetween(moment(travel.end.dateTime), end, duration, app.workAddress, events, eventIndex + 1);
          }
        } else {
          // assume a magical transporter that takes you where you're going instantaneously!
          return addSlotsBetween(start, end, duration, eventAddress, events, eventIndex);
        }
      }
    } else {
      if (events.length > eventIndex && events[eventIndex].travelTo) {
        var fromHome = events[eventIndex].travelTo.find(t => t.origin === app.homeAddress);
        var fromWork = events[eventIndex].travelTo.find(t => t.origin === app.workAddress);
        if (startAddress === app.homeAddress && app.homeAddress !== "") {
          if (fromWork && moment(fromWork.leave).isAfter(workStarts)) {
            // there's time to go to work first
            travel = {
              ...travel,
              destination: app.workAddress,
              start: { dateTime: start },
              end: { dateTime: workStarts },
              mode: app.travelMode
            }
            events.splice(eventIndex, 0, travel);
            return addSlotsBetween(moment(travel.end.dateTime), end, duration, travel.destination, events, eventIndex + 1);
          } else if (fromHome) {
            // go straight there, even if it means leaving home a little later than usual
            travel = {
              ...travel,
              start: { dateTime: fromHome.leave },
              end: { dateTime: eventStarts },
              mode: fromHome.mode || app.travelMode
            }
            events.splice(eventIndex, 0, travel);
            // skip to after the event
            return addSlotsBetween(moment(eventEnds), end, duration, eventAddress, events, eventIndex + 2);
          } else {
            // assume a magical transporter that takes you where you're going instantaneously!
            return addSlotsBetween(start, end, duration, eventAddress, events, eventIndex);
          }
        } else if (startAddress !== app.workAddress && eventIndex > 0 && events[eventIndex - 1].travelFrom) {
          var toWork = events[eventIndex - 1].travelFrom.find(t => t.destination === app.workAddress);
          if (toWork && moment(toWork.arrive).isSameOrAfter(fromWork.leave)) {
            // go straight to the next place you need to be at
            travelFrom = events[eventIndex - 1].travelFrom.find(t => originalAddresses(t.destination).includes(eventAddress));
            if (travelFrom) {
              travel = {
                ...travel,
                start: { dateTime: start },
                end: { dateTime: travelFrom.arrive },
                mode: travelFrom.mode || app.travelMode
              }
              events.splice(eventIndex, 0, travel);
              return addSlotsBetween(moment(travel.end.dateTime), end, duration, eventAddress, events, eventIndex + 1);
            } else {
              // assume a magical transporter that takes you there instantaneously!
              // note change to address
              return addSlotsBetween(start, end, duration, eventAddress, events, eventIndex);
            }
          } else if (toWork) {
            // go back to work before travelling on
            travel = {
              ...travel,
              destination: app.workAddress,
              start: { dateTime: start },
              end: { dateTime: toWork.arrive },
              mode: toWork.mode || app.travelMode
            };
            events.splice(eventIndex, 0, travel);
            // maybe do something before travelling
            return addSlotsBetween(moment(toWork.arrive), end, duration, app.workAddress, events, eventIndex + 1);
          }
        } else {
          travelTo = events[eventIndex].travelTo.find(t => originalAddresses(t.origin).includes(startAddress));
          if (travelTo) {
            travel = {
              ...travel,
              start: { dateTime: travelTo.leave },
              end: { dateTime: eventStarts },
              mode: travelTo.mode || app.travelMode
            }
            events.splice(eventIndex, 0, travel);
            if (start.isBefore(travelTo.leave)) {
              // maybe do something before travelling now there's that event
              return addSlotsBetween(start, end, duration, startAddress, events, eventIndex);
            } else {
              return addSlotsBetween(moment(eventStarts), end, duration, travel.destination, events, eventIndex + 1);
            }
          } else {
            // assume a magical transporter that takes you there instantaneously!
            // (note change to eventAddress)
            return addSlotsBetween(start, end, duration, eventAddress, events, eventIndex);
          }
        }
      } else if (eventIndex > 0 && events[eventIndex - 1].travelFrom) {
        // try to travel to eventAddress
        var travelFrom = events[eventIndex - 1].travelFrom.find(t => originalAddresses(t.destination).includes(eventAddress));
        if (travelFrom) {
          travel = {
            ...travel,
            start: { dateTime: start },
            end: { dateTime: travelFrom.arrive },
            mode: travelFrom.mode || app.travelMode
          }
          events.splice(eventIndex, 0, travel);
          return addSlotsBetween(moment(travel.end.dateTime), end, duration, eventAddress, events, eventIndex + 1);
        } else {
          // assume a magical transporter that takes you there instantaneously!
          return addSlotsBetween(start, end, duration, eventAddress, events, eventIndex);
        }
      }
    }
  }
  // move on to the next event
  if (eventIndex < events.length) {
    return addSlotsBetween(moment(eventEnds), end, duration, eventAddress, events, eventIndex + 1);
  } else {
    return events;
  }
}
