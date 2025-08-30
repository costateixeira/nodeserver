/**
 * VersionUtilities - JavaScript implementation
 * Port of the Java VersionUtilities class for FHIR version handling
 */

const { Utilities } = require('./utilities');

// Custom error class (equivalent to FHIRException)
class FHIRException extends Error {
    constructor(message) {
        super(message);
        this.name = 'FHIRException';
    }
}

// Enums
const VersionPrecision = {
    MAJOR: 'MAJOR',
    MINOR: 'MINOR',
    PATCH: 'PATCH',
    FULL: 'FULL'
};

class SemverParser {
    static parseSemver(version, allowWildcards = false) {
        const result = new ParseResult();

        if (Utilities.noString(version)) {
            result.error = 'Empty version';
            return result;
        }

        // Handle question mark suffix
        let versionStr = version;
        if (versionStr.endsWith('?')) {
            versionStr = versionStr.slice(0, -1);
        }

        // Split into main version and labels
        let mainVersion = versionStr;
        let releaseLabel = null;
        let build = null;

        // Extract build metadata (after +)
        const plusIndex = mainVersion.indexOf('+');
        if (plusIndex >= 0) {
            build = mainVersion.substring(plusIndex + 1);
            mainVersion = mainVersion.substring(0, plusIndex);
        }

        // Extract pre-release (after -)
        const dashIndex = mainVersion.indexOf('-');
        if (dashIndex >= 0) {
            releaseLabel = mainVersion.substring(dashIndex + 1);
            mainVersion = mainVersion.substring(0, dashIndex);
        }

        // Split version parts
        const parts = mainVersion.split('.');

        // For semver, we need at least major.minor, but no more than major.minor.patch
        if (parts.length < 2) {
            result.error = 'Version must have at least major.minor';
            return result;
        }
        if (parts.length > 3) {
            result.error = 'Version cannot have more than major.minor.patch';
            return result;
        }

        // Validate parts
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!allowWildcards && !Utilities.isInteger(part)) {
                result.error = `Invalid version part: ${part}`;
                return result;
            }
            if (allowWildcards && !Utilities.isInteger(part) && !Utilities.existsInList(part, "x", "X", "*")) {
                result.error = `Invalid version part with wildcards: ${part}`;
                return result;
            }
            // Check for leading zeros (except for "0" itself)
            if (Utilities.isInteger(part) && part.length > 1 && part.startsWith('0')) {
                result.error = `Invalid leading zero in version part: ${part}`;
                return result;
            }
        }

        // Check for invalid pre-release formats
        if (releaseLabel !== null) {
            if (releaseLabel === '') {
                result.error = 'Empty pre-release label';
                return result;
            }
            // Check for leading zeros in numeric pre-release identifiers
            const releaseParts = releaseLabel.split('.');
            for (const part of releaseParts) {
                if (Utilities.isInteger(part) && part.length > 1 && part.startsWith('0')) {
                    result.error = `Invalid leading zero in pre-release: ${part}`;
                    return result;
                }
            }
        }

        // Check for invalid build formats
        if (build !== null && build === '') {
            result.error = 'Empty build metadata';
            return result;
        }

        result.major = parts[0] || null;
        result.minor = parts[1] || null;
        result.patch = parts.length >= 3 ? parts[2] : null;
        result.releaseLabel = releaseLabel;
        result.build = build;
        result.success = true;

        return result;
    }
}

class ParseResult {
    constructor() {
        this.success = false;
        this.error = null;
        this.major = null;
        this.minor = null;
        this.patch = null;
        this.releaseLabel = null;
        this.build = null;
    }

    isSuccess() {
        return this.success;
    }

    getMajor() {
        return this.major;
    }

    getMinor() {
        return this.minor;
    }

    getPatch() {
        return this.patch;
    }

    getReleaseLabel() {
        return this.releaseLabel;
    }

    getBuild() {
        return this.build;
    }

    getError() {
        return this.error;
    }
}

class VersionUtilities {
    static SUPPORTED_MAJOR_VERSIONS = ["1.0", "1.4", "3.0", "4.0", "5.0", "6.0"];
    static SUPPORTED_VERSIONS = ["1.0.2", "1.4.0", "3.0.2", "4.0.1", "4.1.0", "4.3.0", "5.0.0", "6.0.0"];

    /**
     * Returns the package name for the given FHIR version.
     * @param {string} v FHIR version string
     * @return {string|null} package name (e.g., "hl7.fhir.r4.core") or null if version not recognized
     */
    static packageForVersion(v) {
        if (this.isR2Ver(v)) {
            return "hl7.fhir.r2.core";
        }
        if (this.isR2BVer(v)) {
            return "hl7.fhir.r2b.core";
        }
        if (this.isR3Ver(v)) {
            return "hl7.fhir.r3.core";
        }
        if (this.isR4Ver(v)) {
            return "hl7.fhir.r4.core";
        }
        if (this.isR4BVer(v)) {
            return "hl7.fhir.r4b.core";
        }
        if (this.isR5Ver(v)) {
            return "hl7.fhir.r5.core";
        }
        if (this.isR6Ver(v)) {
            return "hl7.fhir.r6.core";
        }
        if (v === "current") {
            return "hl7.fhir.r5.core";
        }
        return null;
    }

    /**
     * Returns the current/latest version for a given FHIR version family.
     * @param {string} v FHIR version string
     * @return {string} current version string for that family
     */
    static getCurrentVersion(v) {
        if (this.isR2Ver(v)) {
            return "1.0.2";
        }
        if (this.isR2BVer(v)) {
            return "1.4.0";
        }
        if (this.isR3Ver(v)) {
            return "3.0.2";
        }
        if (this.isR4Ver(v)) {
            return "4.0.1";
        }
        if (this.isR5Ver(v)) {
            return "5.0.0";
        }
        if (this.isR6Ver(v)) {
            return "6.0.0";
        }
        return v;
    }

    /**
     * Returns the current package version for a given FHIR version family.
     * @param {string} v FHIR version string
     * @return {string} package version (major.minor format)
     */
    static getCurrentPackageVersion(v) {
        if (this.isR2Ver(v)) {
            return "1.0";
        }
        if (this.isR2BVer(v)) {
            return "1.4";
        }
        if (this.isR3Ver(v)) {
            return "3.0";
        }
        if (this.isR4Ver(v)) {
            return "4.0";
        }
        if (this.isR5Ver(v)) {
            return "5.0";
        }
        if (this.isR6Ver(v)) {
            return "6.0";
        }
        return v;
    }

    /**
     * Checks if the given version is in the list of supported FHIR versions.
     * @param {string} version version string to check
     * @return {boolean} true if version is supported
     */
    static isSupportedVersion(version) {
        version = this.checkVersionNotNullAndValid(this.removeLabels(this.fixForSpecialValue(version)));
        return Utilities.existsInList(version, ...this.SUPPORTED_VERSIONS);
    }

    /**
     * Returns a comma-separated list of all supported FHIR versions.
     * @return {string} string listing supported versions
     */
    static listSupportedVersions() {
        return this.SUPPORTED_VERSIONS.join(", ");
    }

    /**
     * Returns a comma-separated list of all supported major FHIR versions.
     * @return {string} string listing supported major versions
     */
    static listSupportedMajorVersions() {
        return this.SUPPORTED_MAJOR_VERSIONS.join(", ");
    }

    /**
     * returns true if version refers to any R6 release (including rX/RX variants)
     */
    static isR6Plus(version) {
        return this.isR6Ver(version);
    }

    /**
     * Checks if version refers to any R6 release.
     * @param {string} version version string to check
     * @return {boolean} true if R6 version
     */
    static isR6Ver(version) {
        version = this.removeLabels(this.checkVersionValid(this.fixForSpecialValue(version)));
        return version != null && version.startsWith("6.0");
    }

    /**
     * returns true if version refers to any R5 release (including pre-release versions starting from 4.5) (including rX/RX variants)
     */
    static isR5Plus(version) {
        return this.isR5Ver(version) || this.isR6Plus(version);
    }

    /**
     * Checks if version refers to any R5 release (including 4.5+ pre-releases).
     * @param {string} version version string to check
     * @return {boolean} true if R5 version
     */
    static isR5Ver(version) {
        version = this.removeLabels(this.checkVersionValid(this.fixForSpecialValue(version)));
        return version != null && (version.startsWith("4.5") || version.startsWith("5.0"));
    }

    /**
     * Checks if version refers to any R4B release.
     * @param {string} version version string to check
     * @return {boolean} true if R4B version
     */
    static isR4BVer(version) {
        version = this.removeLabels(this.checkVersionValid(this.fixForSpecialValue(version)));
        return version != null && (version.startsWith("4.1") || version.startsWith("4.3"));
    }

    /**
     * Checks if version refers to any R4 release (including 3.2+ pre-releases).
     * @param {string} version version string to check
     * @return {boolean} true if R4 version
     */
    static isR4Ver(version) {
        version = this.removeLabels(this.checkVersionValid(this.fixForSpecialValue(version)));
        return version != null && (version.startsWith("4.0") ||
            // pre-release versions
            version.startsWith("3.2") || version.startsWith("3.3") ||
            version.startsWith("3.4") || version.startsWith("3.5"));
    }

    /**
     * returns true if version refers to any R4 release (including pre-release versions starting from 3.2) (including rX/RX variants)
     */
    static isR4Plus(version) {
        return this.isR4Ver(version) || this.isR4BVer(version) || this.isR5Plus(version);
    }

    /**
     * Checks if version refers to any R3 release.
     * @param {string} version version string to check
     * @return {boolean} true if R3 version
     */
    static isR3Ver(version) {
        version = this.removeLabels(this.checkVersionValid(this.fixForSpecialValue(version)));
        return version != null && version.startsWith("3.0");
    }

    /**
     * Checks if version refers to any R2B release.
     * @param {string} version version string to check
     * @return {boolean} true if R2B version
     */
    static isR2BVer(version) {
        version = this.removeLabels(this.checkVersionValid(this.fixForSpecialValue(version)));
        return version != null && version.startsWith("1.4");
    }

    /**
     * Checks if version refers to any R2 release.
     * @param {string} version version string to check
     * @return {boolean} true if R2 version
     */
    static isR2Ver(version) {
        version = this.removeLabels(this.checkVersionValid(this.fixForSpecialValue(version)));
        return version != null && version.startsWith("1.0");
    }

    /**
     * Checks if the given string is a FHIR core package name.
     * @param {string} s package name to check
     * @return {boolean} true if it's a core package
     */
    static isCorePackage(s) {
        if (s == null) {
            return false;
        }
        if (s.includes("#")) {
            s = s.substring(0, s.indexOf("#"));
        }
        return Utilities.existsInList(s, "hl7.fhir.core", "hl7.fhir.r2.core", "hl7.fhir.r2b.core",
            "hl7.fhir.r3.core", "hl7.fhir.r4.core", "hl7.fhir.r4b.core", "hl7.fhir.r5.core", "hl7.fhir.r6.core");
    }

    /**
     * Returns version string with labels (pre-release/build info) removed.
     * @param {string} version version string
     * @return {string|null} version without labels, or null if invalid
     */
    static versionWithoutLabels(version) {
        version = this.checkVersionNotNullAndValid(this.fixForSpecialValue(version));
        return this.removeLabels(version);
    }

    /**
     * given any valid semver string, returns major.minor. Also accepts the special values rX/RX where X is a major FHIR version (2,2B,3,4,4B,5,6)
     *
     * returns null if not a valid semver
     */
    static getMajMin(version) {
        version = this.removeLabels(this.fixForSpecialValue(version));
        if (version == null) {
            return null;
        }
        if (!this.isSemVer(version)) {
            return null;
        }
        return this.getMajMinPriv(version);
    }

    static getMajMinPriv(version) {
        const p = version.split(".");
        return p[0] + "." + p[1];
    }

    /**
     * given any valid semver string, returns major.minor.patch. Also accepts the special values rX/RX where X is a major FHIR version (2,2B,3,4,4B,5,6)
     *
     * if there's no patch, it will be assumed to be 0
     *
     * returns null if it's not a valid semver
     */
    static getMajMinPatch(version) {
        version = this.removeLabels(this.fixForSpecialValue(version));
        if (version == null) {
            return null;
        }
        if (!this.isSemVer(version)) {
            return null;
        }
        const p = version.split(".");
        return p[0] + "." + p[1] + (p.length >= 3 ? "." + p[2] : ".0");
    }

    /**
     * given any valid semver string, returns just the patch version, with no labels. Also accepts the special values rX/RX where X is a major FHIR version (2,2B,3,4,4B,5,6)
     */
    static getPatch(version) {
        version = this.removeLabels(this.checkVersionValid(this.fixForSpecialValue(version)));
        if (version == null)
            return null;
        return this.getPatchPriv(version);
    }

    static getPatchPriv(version) {
        const p = version.split(".");
        return p.length >= 3 ? p[2] : "0";
    }

    /**
     * returns true if this is a valid semver. we accept major.minor without a patch. This one does not accept the codes such as RX
     */
    static isSemVer(version) {
        if (Utilities.noString(version)) {
            return false;
        }
        const pr = SemverParser.parseSemver(version, false, false);
        if (!pr.isSuccess()) {
            return false;
        }
        return Utilities.isInteger(pr.getMajor()) && Utilities.isInteger(pr.getMinor()) &&
            (pr.getPatch() == null || Utilities.isInteger(pr.getPatch()));
    }

    /**
     * Checks if version string is valid semver with wildcard support.
     * @param {string} version version string to validate
     * @return {boolean} true if valid semver with wildcards
     */
    static isSemVerWithWildcards(version) {
        if (Utilities.noString(version)) {
            return false;
        }
        const pr = SemverParser.parseSemver(version, true, false);
        if (!pr.isSuccess()) {
            return false;
        }
        return Utilities.isInteger(pr.getMajor()) && this.isIntegerOrX(pr.getMinor()) &&
            (pr.getPatch() == null || this.isIntegerOrX(pr.getPatch()));
    }

    static isIntegerOrX(p) {
        return Utilities.existsInList(p, "x", "*", "X") || Utilities.isInteger(p);
    }

    /**
     * Returns true if the version string contains any wildcard characters.
     * Supported wildcards are: * (asterisk) anywhere, x/X (in major/minor/patch only), and ? (question mark suffix).
     * Note: x and X are only wildcards in version number parts, not in release labels (after -) or build labels (after +).
     *
     * @param {string} version version string to check
     * @return {boolean} true if version contains any wildcard characters, false otherwise
     */
    static versionHasWildcards(version) {
        if (Utilities.noString(version)) {
            return false;
        }

        // Check for ? suffix wildcard
        if (version.endsWith("?")) {
            return true;
        }

        // Check for * wildcard anywhere
        if (version.includes("*")) {
            return true;
        }

        // For x/X wildcards, we need to check only the version number parts (before any - or +)
        let versionPart = version;
        const dashIndex = version.indexOf('-');
        const plusIndex = version.indexOf('+');

        if (dashIndex >= 0 && plusIndex >= 0) {
            versionPart = version.substring(0, Math.min(dashIndex, plusIndex));
        } else if (dashIndex >= 0) {
            versionPart = version.substring(0, dashIndex);
        } else if (plusIndex >= 0) {
            versionPart = version.substring(0, plusIndex);
        }

        // Check for x/X wildcards only in the version number part
        return versionPart.includes("x") || versionPart.includes("X");
    }

    /**
     * return true if the current version equals criteria, or later, based on the degree of precision specified
     *
     * This can be used to check e.g. if a feature is defined in 4.0, if (VersionUtilities.isThisOrLater("4.0", version))
     *
     * this is only applicable to valid semver versions (though patch is optional)
     *
     * the criteria string can contain wildcards - see versionMatches
     *
     * @param {string} criteria The value to compare to
     * @param {string} candidate The value being compared
     * @param {string} precision how far into the version string to consider (usually just set to full if there's wildcards in the test string)
     *
     * @return {boolean} Is candidate later or equal to criteria? For example, if criteria = 0.5 and candidate = 0.6 this method will return true
     */
    static isThisOrLater(criteria, candidate, precision) {
        criteria = this.checkVersionNotNullAndValidWildcards(this.fixForSpecialValue(criteria), "criteria");
        candidate = this.checkVersionNotNullAndValid(this.fixForSpecialValue(candidate), "candidate");

        let endsWithQ = false;
        if (criteria.endsWith("?")) {
            endsWithQ = true;
            criteria = criteria.substring(0, criteria.length - 1);
        }

        const parsedCriteria = SemverParser.parseSemver(criteria, true, false);
        if (!parsedCriteria.isSuccess()) {
            throw new FHIRException("Invalid criteria: " + criteria + ": (" + parsedCriteria.getError() + ")");
        }

        const parsedCandidate = SemverParser.parseSemver(candidate, false, false);
        if (!parsedCandidate.isSuccess()) {
            throw new FHIRException("Invalid candidate: " + candidate + " (" + parsedCandidate.getError() + ")");
        }

        let thisOrLater;
        thisOrLater = this.partIsThisOrLater(parsedCriteria.getMajor(), parsedCandidate.getMajor(), true);
        if (thisOrLater !== 0) { return thisOrLater < 0 ? true : false; }
        if (endsWithQ && parsedCriteria.getMinor() == null) { return true; }
        if (precision === VersionPrecision.MAJOR) { return true; }
        thisOrLater = this.partIsThisOrLater(parsedCriteria.getMinor(), parsedCandidate.getMinor(), true);
        if (thisOrLater !== 0) { return thisOrLater < 0 ? true : false; }
        if (endsWithQ && parsedCriteria.getPatch() == null) { return true; }
        if (precision === VersionPrecision.MINOR) { return true; }
        thisOrLater = this.partIsThisOrLater(parsedCriteria.getPatch(), parsedCandidate.getPatch(), true);
        if (thisOrLater !== 0) { return thisOrLater < 0 ? true : false; }
        if (precision === VersionPrecision.PATCH) { return true; }
        if (endsWithQ && parsedCriteria.getReleaseLabel() == null && parsedCriteria.getBuild() == null) { return true; }
        thisOrLater = this.partIsThisOrLater(parsedCriteria.getReleaseLabel(), parsedCandidate.getReleaseLabel(), false);
        if (thisOrLater !== 0) { return thisOrLater < 0 ? true : false; }
        thisOrLater = this.partIsThisOrLater(parsedCriteria.getBuild(), parsedCandidate.getBuild(), false);
        if (thisOrLater !== 0) { return thisOrLater < 0 ? true : false; }
        return true;
    }

    static partIsThisOrLater(criteria, candidate, allowX) {
        if (criteria == null) {
            if (candidate == null) {
                return 0;
            } else {
                return allowX ? -1 : 1;
            }
        } else if (candidate == null) {
            return allowX ? 1 : -1;
        } else if (allowX ? Utilities.existsInList(criteria, "*", "x", "X") : Utilities.existsInList(criteria, "*")) {
            return -1;
        } else if (Utilities.isInteger(criteria) && Utilities.isInteger(candidate)) {
            return parseInt(criteria, 10) - parseInt(candidate, 10);
        } else {
            return criteria.localeCompare(candidate);
        }
    }

    /**
     * given any semver, increment the major version and reset the minor and patch to .0.0, and remove any labels
     */
    static incMajorVersion(v) {
        v = this.removeLabels(this.checkVersionNotNullAndValid(this.fixForSpecialValue(v)));
        const parts = this.splitParts(this.removeLabels(v));
        return (parts[0] + 1).toString() + ".0.0";
    }

    /**
     * given any semver, increment the minor version and reset the patch to .0 and remove any labels
     */
    static incMinorVersion(v) {
        v = this.removeLabels(this.checkVersionNotNullAndValid(this.fixForSpecialValue(v)));
        const parts = this.splitParts(this.removeLabels(v));
        return parts[0].toString() + "." + (parts.length === 1 ? "0.0" : (parts[1] + 1).toString() + ".0");
    }

    /**
     * given any semver, increment the patch and remove any labels
     */
    static incPatchVersion(v) {
        v = this.removeLabels(this.checkVersionNotNullAndValid(this.fixForSpecialValue(v)));
        const parts = this.splitParts(v);
        return parts[0].toString() + "." +
            (parts.length < 2 ? "0" : parts[1].toString()) + "." +
            (parts.length < 3 ? "1" : (parts[2] + 1).toString());
    }

    static splitParts(v) {
        const p = v.split(".");
        return p.map(part => parseInt(part, 10));
    }

    /**
     * Converts version code to standard version string.
     * @param {string} version version code or string
     * @return {string} standardized version string
     */
    static versionFromCode(version) {
        return this.checkVersionNotNullAndValid(this.fixForSpecialValue(version));
    }

    // ... (continuing with remaining methods)

    /**
     * returns true if v1 and v2 are both semver, and they 'match'
     */
    static versionMatches(criteria, candidate) {
        if (Utilities.noString(criteria)) {
            throw new FHIRException("Invalid criteria: null / empty");
        }
        if (Utilities.noString(candidate)) {
            throw new FHIRException("Invalid candidate: null / empty");
        }
        criteria = this.fixForSpecialValue(criteria);
        candidate = this.fixForSpecialValue(candidate);

        let endsWithQ = false;
        if (criteria.endsWith("?")) {
            endsWithQ = true;
            criteria = criteria.substring(0, criteria.length - 1);
        }

        const parsedCriteria = SemverParser.parseSemver(criteria, true, false);
        if (!parsedCriteria.isSuccess()) {
            throw new FHIRException("Invalid criteria: " + criteria + ": (" + parsedCriteria.getError() + ")");
        }

        const parsedCandidate = SemverParser.parseSemver(candidate, false, false);
        if (!parsedCandidate.isSuccess()) {
            throw new FHIRException("Invalid candidate: " + candidate + " (" + parsedCandidate.getError() + ")");
        }

        if (!this.partMatches(parsedCriteria.getMajor(), parsedCandidate.getMajor(), true)) { return false; }
        if (endsWithQ && parsedCriteria.getMinor() == null) { return true; }
        if (!this.partMatches(parsedCriteria.getMinor(), parsedCandidate.getMinor(), true)) { return false; }
        if (endsWithQ && parsedCriteria.getPatch() == null) { return true; }
        if (!this.partMatches(parsedCriteria.getPatch(), parsedCandidate.getPatch(), true)) { return false; }
        if (endsWithQ && parsedCriteria.getReleaseLabel() == null && parsedCriteria.getBuild() == null) { return true; }
        if (!this.partMatches(parsedCriteria.getReleaseLabel(), parsedCandidate.getReleaseLabel(), false)) { return false; }
        if (!this.partMatches(parsedCriteria.getBuild(), parsedCandidate.getBuild(), false)) { return false; }
        return true;
    }

    static partMatches(criteria, candidate, allowX) {
        if (criteria == null) {
            return candidate == null;
        } else {
            if (allowX ? Utilities.existsInList(criteria, "*", "x", "X") : Utilities.existsInList(criteria, "*")) {
                return candidate != null;
            } else {
                return criteria === candidate;
            }
        }
    }

    /**
     * returns true if v1 matches any v2 using the rules for versionMatches()
     */
    static versionMatchesList(v1, v2l) {
        for (const v2 of v2l) {
            if (this.versionMatches(v1, v2)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Given a canonical URL of format {url}|{version}, remove the version part
     */
    static removeVersionFromCanonical(url) {
        if (url == null) {
            return null;
        }
        if (url.includes("|")) {
            return url.substring(0, url.indexOf("|"));
        } else {
            return url;
        }
    }

    /**
     * given version ver1 and ver2, compare them as semver strings (special values also accepted).
     * -1 means ver1 is earlier, 0 means they 'match' and 1 means ver2 is later (normal java sort order)
     */
    static compareVersions(ver1, ver2) {
        ver1 = this.checkVersionValid(this.fixForSpecialValue(ver1), "ver1");
        ver2 = this.checkVersionValid(this.fixForSpecialValue(ver2), "ver2");

        if (ver1 != null && ver2 != null) {
            const pr1 = SemverParser.parseSemver(ver1, false, false);
            const pr2 = SemverParser.parseSemver(ver2, false, false);
            let res = this.compareVersionStrings(pr1.getMajor(), pr2.getMajor(), true, false);
            if (res === 0) {
                res = this.compareVersionStrings(pr1.getMinor(), pr2.getMinor(), true, false);
            }
            if (res === 0) {
                res = this.compareVersionStrings(pr1.getPatch(), pr2.getPatch(), true, false);
            }
            if (res === 0) {
                res = this.compareVersionStrings(pr1.getReleaseLabel(), pr2.getReleaseLabel(), false, true);
            }
            if (res === 0) {
                res = this.compareVersionStrings(pr1.getBuild(), pr2.getBuild(), false, true);
            }
            return res;
        } else if (ver1 == null) {
            return ver2 == null ? 0 : -1;
        } else {
            return 1;
        }
    }

    static compareVersionStrings(v1, v2, asInteger, inverted) {
        if (v1 == null) {
            if (v2 == null) {
                return 0;
            } else {
                return inverted ? 1 : -1;
            }
        } else if (v2 == null) {
            return inverted ? -1 : 1;
        } else if (asInteger && Utilities.isInteger(v1) && Utilities.isInteger(v2)) {
            const r = parseInt(v1, 10) - parseInt(v2, 10);
            if (r === 0) {
                return 0;
            } else if (r < 0) {
                return -1;
            } else {
                return 1;
            }
        } else {
            const r = v1.localeCompare(v2);
            if (r === 0) {
                return 0;
            } else if (r < 0) {
                return -1;
            } else {
                return 1;
            }
        }
    }

    // Helper methods
    static removeLabels(version) {
        if (Utilities.noString(version))
            return null;
        if (version.includes("+")) {
            version = version.substring(0, version.indexOf("+"));
        }
        if (version.includes("-")) {
            version = version.substring(0, version.indexOf("-"));
        }
        return version;
    }

    static checkVersionNotNullAndValid(s, label = null) {
        if (s == null) {
            throw new FHIRException("Invalid" + (label ? " " + label : "") + " version: null");
        } else if (!this.isSemVer(s)) {
            throw new FHIRException("Invalid" + (label ? " " + label : "") + " version: '" + s + "'");
        } else {
            return s;
        }
    }

    static checkVersionNotNullAndValidWildcards(s, label = null) {
        if (s == null) {
            throw new FHIRException("Invalid" + (label ? " " + label : "") + " version: null");
        } else if (!this.isSemVerWithWildcards(s)) {
            throw new FHIRException("Invalid" + (label ? " " + label : "") + " version: '" + s + "'");
        } else {
            return s;
        }
    }

    static checkVersionValid(s, label = null) {
        if (s == null) {
            return null;
        } else if (!this.isSemVer(s)) {
            throw new FHIRException("Invalid" + (label ? " " + label : "") + " version: '" + s + "'");
        } else {
            return s;
        }
    }

    static fixForSpecialValue(version) {
        if (Utilities.noString(version)) {
            return null;
        }
        if (version.startsWith("http://hl7.org/fhir/")) {
            version = version.substring(20);
            if (version.includes("/")) {
                version = version.substring(0, version.indexOf("/"));
            }
        }

        switch (version.toUpperCase()) {
            case "R2":
                return "1.0.2";
            case "DSTU2":
                return "1.0.2";
            case "R2B":
                return "1.4.0";
            case "R3":
                return "3.0.2";
            case "STU3":
                return "3.0.2";
            case "R4":
                return "4.0.1";
            case "R4B":
                return "4.3.0";
            case "R5":
                return "5.0.0";
            case "R6":
                return "6.0.0-cibuild";
            default:
                return version;
        }
    }
}

module.exports = { VersionUtilities, VersionPrecision, FHIRException, SemverParser };
