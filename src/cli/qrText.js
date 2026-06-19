import vcardjs from 'vcards-js';

export const interpretEscapeSequences = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\([nrtbfv'"\\])/g, (_, ch) => ({
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      v: '\v',
      "'": "'",
      '"': '"',
      '\\': '\\',
    })[ch] ?? `\\${ch}`);
};

export const wifiQREscape = (str) => String(str || '').replace(/([:|\\|;|,|"])/gm, '\\$1');

const formatICalDate = (date, time, allDay) => {
  if (allDay) return date.replace(/-/g, '');
  return new Date(`${date}T${time}:00`).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
};

const escapeICalString = (str) => {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
};

export const generateICalString = (calendar) => {
  if (!calendar.eventName || !calendar.startDate || !calendar.endDate) {
    return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QRCode2STL//printer.tools//EN\r\nEND:VCALENDAR';
  }

  const dtstart = formatICalDate(calendar.startDate, calendar.startTime, calendar.allDay);
  let dtend = formatICalDate(calendar.endDate, calendar.endTime, calendar.allDay);

  if (calendar.allDay) {
    const endDate = new Date(calendar.endDate);
    endDate.setDate(endDate.getDate() + 1);
    dtend = endDate.toISOString().split('T')[0].replace(/-/g, '');
  }

  let icalString = 'BEGIN:VCALENDAR\r\n';
  icalString += 'VERSION:2.0\r\n';
  icalString += 'PRODID:-//QRCode2STL//printer.tools//EN\r\n';
  icalString += 'BEGIN:VEVENT\r\n';
  icalString += `UID:${Date.now().toString(36)}\r\n`;
  icalString += `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z\r\n`;
  icalString += calendar.allDay ? `DTSTART;VALUE=DATE:${dtstart}\r\n` : `DTSTART:${dtstart}\r\n`;
  icalString += calendar.allDay ? `DTEND;VALUE=DATE:${dtend}\r\n` : `DTEND:${dtend}\r\n`;
  icalString += `SUMMARY:${escapeICalString(calendar.eventName)}\r\n`;

  if (calendar.description) icalString += `DESCRIPTION:${escapeICalString(calendar.description)}\r\n`;
  if (calendar.location) icalString += `LOCATION:${escapeICalString(calendar.location)}\r\n`;

  icalString += 'END:VEVENT\r\n';
  icalString += 'END:VCALENDAR';
  return icalString;
};

export const getQRText = (options) => {
  switch (options.activeTabIndex) {
    case 0:
      return options.useEscapeSequences ? interpretEscapeSequences(options.text) : options.text;
    case 1: {
      const security = options.wifi.password === '' ? 'nopass' : options.wifi.security;
      const password = security === 'nopass' ? '' : options.wifi.password;
      return `WIFI:S:${wifiQREscape(options.wifi.ssid)};T:${wifiQREscape(security)};P:${wifiQREscape(password)};H:${options.wifi.hidden ? 'true' : 'false'};`;
    }
    case 2:
      return `mailto:${options.email.recipient.split(',').map(x => x.trim()).join(',')}?subject=${encodeURI(options.email.subject)}&body=${encodeURI(options.email.body)}`;
    case 3: {
      const vCard = vcardjs();
      vCard.firstName = options.contact.firstName;
      vCard.lastName = options.contact.lastName;
      vCard.organization = options.contact.organization;
      vCard.url = options.contact.website;
      vCard.role = options.contact.role;
      vCard.homePhone = options.contact.phone;
      vCard.cellPhone = options.contact.cell;
      vCard.homeFax = options.contact.fax;
      vCard.email = options.contact.email;
      vCard.homeAddress.street = options.contact.street;
      vCard.homeAddress.city = options.contact.city;
      vCard.homeAddress.stateProvince = options.contact.state;
      vCard.homeAddress.postalCode = options.contact.postcode;
      vCard.homeAddress.countryRegion = options.contact.country;
      vCard.version = '3.0';
      return vCard.getFormattedString();
    }
    case 4:
      return `SMSTO:${options.sms.recipient}:${options.sms.message}`;
    case 5:
      return generateICalString(options.calendar);
    default:
      return '';
  }
};
