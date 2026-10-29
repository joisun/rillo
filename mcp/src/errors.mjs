export class RilloError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'RilloError'
    this.code = code
    this.details = details
  }
}
