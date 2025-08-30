const assert = require("assert");
const {Languages} = require("../library/languages");

class OperationContext {

  constructor(langs) {
    this.langs = this._ensureLanguages(langs);
  }

  _ensureLanguages(param) {
    assert(typeof param === 'string' || param instanceof Languages, 'Parameter must be string or Languages object');
    return typeof param === 'string' ? Languages.fromAcceptLanguage(param) : param;
  }

  /**
   * @type {Languages} languages specified in request
   */
  langs;
}


module.exports = {
  OperationContext
};