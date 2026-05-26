export type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type LocalDate = {
  year: number;
  month: number;
  day: number;
};

const LOCAL_DATE_TIME_KEYS = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;
const LOCAL_DATE_KEYS = ['year', 'month', 'day'] as const;

const DATE_TIME_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;
const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})/;

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function pad4(n: number): string {
  return n.toString().padStart(4, '0');
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const ownKeys = Object.keys(value);

  if (ownKeys.length !== keys.length) {
    return false;
  }

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return false;
    }
  }

  return true;
}

function allNumbers(value: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    if (typeof value[key] !== 'number') {
      return false;
    }
  }

  return true;
}

export function isLocalDateTime(value: unknown): value is LocalDateTime {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    hasExactKeys(value, LOCAL_DATE_TIME_KEYS) &&
    allNumbers(value as Record<string, unknown>, LOCAL_DATE_TIME_KEYS)
  );
}

export function isLocalDate(value: unknown): value is LocalDate {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    hasExactKeys(value, LOCAL_DATE_KEYS) &&
    allNumbers(value as Record<string, unknown>, LOCAL_DATE_KEYS)
  );
}

export function decodeLocalDateTime(value: string): LocalDateTime {
  const match = DATE_TIME_REGEX.exec(value);

  if (!match) {
    throw new Error(`@contello/client: cannot decode LocalDateTime from "${value}"`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  };
}

export function decodeLocalDate(value: string): LocalDate {
  const match = DATE_REGEX.exec(value);

  if (!match) {
    throw new Error(`@contello/client: cannot decode LocalDate from "${value}"`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function encodeLocalDateTime(value: LocalDateTime): string {
  return (
    `${pad4(value.year)}-${pad2(value.month)}-${pad2(value.day)}` +
    `T${pad2(value.hour)}:${pad2(value.minute)}:${pad2(value.second)}Z`
  );
}

export function encodeLocalDate(value: LocalDate): string {
  return `${pad4(value.year)}-${pad2(value.month)}-${pad2(value.day)}T00:00:00Z`;
}
