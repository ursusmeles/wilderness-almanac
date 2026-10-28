export const TIME_INCREMENTS = ['week', 'day', 'session'];

// Counts keep their existing storage fields; the chosen increment is a 1:1 label.
export function timeIncrementLabels(value = 'week') {
  const unit = TIME_INCREMENTS.includes(value) ? value : 'week';
  return { unit, label: unit[0].toUpperCase() + unit.slice(1), plural: `${unit}s` };
}

export function periodEvent(entry, increment) {
  if (entry.kind !== 'week') return entry;
  const { unit } = timeIncrementLabels(increment);
  return {
    ...entry,
    text: entry.text.replace(/ lived another (?:week|day|session)\.$/, ` lived another ${unit}.`),
  };
}
