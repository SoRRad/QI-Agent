/** Errors the Pulse actions turn into specific messages. */

export class PulseRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PulseRuleError";
  }
}

export class PulsePermissionError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "PulsePermissionError";
  }
}

export class PulseNotFoundError extends Error {
  constructor(message = "That could not be found.") {
    super(message);
    this.name = "PulseNotFoundError";
  }
}
