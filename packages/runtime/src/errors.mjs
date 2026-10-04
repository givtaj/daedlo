export class DriverError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DriverError";
    this.code = code;
  }
}
export const reject = (code, message) => {
  throw new DriverError(code, message);
};
