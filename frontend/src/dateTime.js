const TIME_ZONE = 'Asia/Ho_Chi_Minh';

export function formatVietnamDateTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
}

export function parseVietnamDateTimeInput(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return null;
  const [, dayText, monthText, yearText, hourText, minuteText] = match;
  const [day, month, year, hour, minute] = [dayText, monthText, yearText, hourText, minuteText].map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || hour > 23 || minute > 59) return null;
  return `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}`;
}
