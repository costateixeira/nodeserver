// // Convert input to Languages instance if needed
// const langs = languages instanceof Languages ? languages :
//   Array.isArray(languages) ? Languages.fromAcceptLanguage(languages.join(',')) :
//     Languages.fromAcceptLanguage(languages || '');

// code instanceof CodeSystemProviderContext ? this.code


// const {Language} = require("./languages");
// if (designation.language) {
//   const designationLang = new Language(designation.language);
//   for (const requestedLang of langs) {
//     if (designationLang.matchesForDisplay(requestedLang)) {

const Utilities = {
  noString: (str) => str == null || str.trim() === '',
  existsInList: (item, ...list) => list.includes(item),
  isInteger: (str) => {
    if (typeof str !== 'string' || str === '') return false;
    const num = parseInt(str, 10);
    return num.toString() === str && !isNaN(num);
  }

};

function validateParameter(param, name, type) {
  if (param == null) {
    throw new Error(`${name} must be a provided`);
  }
  if (type === String) {
    if (typeof param !== 'string') {
      throw new Error(`${name} must be a string`);
    }
  } else if (type === Number) {
    if (typeof param !== 'number' || isNaN(param)) {
      throw new Error(`${name} must be a number`);
    }
  } else if (type === Boolean) {
    if (typeof param !== 'boolean') {
      throw new Error(`${name} must be a boolean`);
    }
  } else {
    // Handle object types with instanceof
    if (!(param instanceof type)) {
      throw new Error(`${name} must be a valid ${type.name}`);
    }
  }
}

function validateOptionalParameter(param, name, type) {
  if (param != null) {
    if (!(param instanceof type)) {
      throw new Error(`${name} must be a valid ${type}`);
    }
  }
}

module.exports = { Utilities, validateParameter, validateOptionalParameter };
