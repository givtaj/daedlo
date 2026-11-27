// Browser Driver adaptation of the Roots driver: generalized model, execution and viewer interfaces; later lifecycle and reporting changes. See THIRD_PARTY_NOTICES.md and licenses/Apache-2.0.txt at the package root.
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
