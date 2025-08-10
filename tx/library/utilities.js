// // Convert input to Languages instance if needed
// const langs = languages instanceof Languages ? languages :
//   Array.isArray(languages) ? Languages.fromAcceptLanguage(languages.join(',')) :
//     Languages.fromAcceptLanguage(languages || '');

// code instanceof CodeSystemProviderContext ? this.code


const {Language} = require("./languages");
if (designation.language) {
  const designationLang = new Language(designation.language);
  for (const requestedLang of langs) {
    if (designationLang.matchesForDisplay(requestedLang)) {

