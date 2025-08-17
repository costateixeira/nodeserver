/**
 * VersionUtilities Jest Test Suite
 * JavaScript port of the Java JUnit tests
 */

const { VersionUtilities, VersionPrecision, FHIRException, SemverParser } = require('../../library/version-utilities');

describe('VersionUtilities', () => {

    describe('isSemVer', () => {
        test('should validate basic semver versions', () => {
            test_isSemVer("0.1.1", true);
            test_isSemVer("0.1.1-ballot1", true);
            test_isSemVer("0.0.0-alpha.0.131", true);
            test_isSemVer("0.1.a", false);
        });

        test('should handle valid semver formats', () => {
            test_isSemVer("1.0.0", true);
            test_isSemVer("2.1.3", true);
            test_isSemVer("10.20.30", true);
            test_isSemVer("0.0.1", true);
        });

        test('should handle valid semver with prerelease', () => {
            test_isSemVer("1.0.0-alpha", true);
            test_isSemVer("2.1.0-beta.1", true);
            test_isSemVer("3.2.5-rc.2", true);
            test_isSemVer("1.0.0-alpha.beta", true);
            test_isSemVer("1.0.0-alpha.1", true);
        });

        test('should handle two-part versions', () => {
            test_isSemVer("1.0", true);
            test_isSemVer("2.5", true);
            test_isSemVer("10.15", true);
        });

        test('should reject single-part versions', () => {
            test_isSemVer("1", false);
            test_isSemVer("5", false);
            test_isSemVer("10", false);
        });

        test('should reject FHIR special versions', () => {
            test_isSemVer("r2", false);
            test_isSemVer("r3", false);
            test_isSemVer("r4", false);
            test_isSemVer("r4B", false);
            test_isSemVer("r5", false);
            test_isSemVer("r6", false);
            test_isSemVer("R2", false);
            test_isSemVer("R3", false);
            test_isSemVer("R4", false);
            test_isSemVer("R4B", false);
            test_isSemVer("R5", false);
            test_isSemVer("R6", false);
        });

        test('should reject invalid versions', () => {
            test_isSemVer("", false);
            test_isSemVer(null, false);
            test_isSemVer("1.0.0.0", false);
            test_isSemVer("1.0.", false);
            test_isSemVer("1..0", false);
            test_isSemVer("a.b.c", false);
            test_isSemVer("1.0.0-", false);
            test_isSemVer("r7", false);
            test_isSemVer("r", false);
        });

        test('should handle complex labels', () => {
            test_isSemVer("1.0.0-alpha+build", true);
            test_isSemVer("1.0.0-alpha-beta+build-123", true);
            test_isSemVer("1.0.0-alpha.1+build.2", true);
            test_isSemVer("1.0.0-0.1.2+build.3.4", true);
            test_isSemVer("1.0.0+build-only", true);
            test_isSemVer("1.0.0-prerelease-only", true);
        });

        test('should reject leading zeros', () => {
            test_isSemVer("01.0.0", false);
            test_isSemVer("1.01.0", false);
            test_isSemVer("1.0.01", false);
            test_isSemVer("001.002.003", false);
            test_isSemVer("0.0.0", true); // Zero itself is fine
            test_isSemVer("1.0.0", true);
        });
    });

    describe('isThisOrLater', () => {
        test('should handle simple comparisons', () => {
            test_isThisOrLaterMajorMinor("0.1", "0.2", true);
            test_isThisOrLaterMajorMinor("0.2", "0.1", false);
        });

        test('should use numeric comparison', () => {
            test_isThisOrLaterMajorMinor("0.9", "0.10", true);
            test_isThisOrLaterMajorMinor("0.10", "0.9", false);
        });

        test('should handle different lengths', () => {
            test_isThisOrLaterMajorMinor("0.9", "0.9.1", true);
            test_isThisOrLaterMajorMinor("0.9.1", "0.9", true);
            test_isThisOrLater("0.9", "0.9.1", true);
            test_isThisOrLater("0.9.1", "0.9", false);
        });

        test('should handle same versions', () => {
            test_isThisOrLaterMajorMinor("1.0.0", "1.0.0", true);
            test_isThisOrLaterMajorMinor("2.1.3", "2.1.3", true);
            test_isThisOrLaterMajorMinor("r4", "r4", true);
            test_isThisOrLaterMajorMinor("R5", "r5", true);
        });

        test('should handle later versions', () => {
            test_isThisOrLaterMajorMinor("1.0.0", "1.0.1", true);
            test_isThisOrLaterMajorMinor("1.0.0", "1.1.0", true);
            test_isThisOrLaterMajorMinor("1.0.0", "2.0.0", true);
            test_isThisOrLaterMajorMinor("2.1.0", "2.1.5", true);
            test_isThisOrLaterMajorMinor("r3", "r4", true);
            test_isThisOrLaterMajorMinor("r4", "r5", true);
        });
    });

    describe('getMajMin', () => {
        test('should extract major.minor from standard semver', () => {
            test_getMajMin("1.0.0", "1.0");
            test_getMajMin("2.1.3", "2.1");
            test_getMajMin("10.5.2", "10.5");
            test_getMajMin("0.9.1", "0.9");
        });

        test('should extract major.minor with prerelease', () => {
            test_getMajMin("1.0.0-alpha", "1.0");
            test_getMajMin("2.1.0-beta.1", "2.1");
            test_getMajMin("3.2.5-rc.2", "3.2");
        });

        test('should handle two-part versions', () => {
            test_getMajMin("1.0", "1.0");
            test_getMajMin("2.5", "2.5");
        });

        test('should return null for single-part versions', () => {
            test_getMajMin("1", null);
            test_getMajMin("5", null);
        });

        test('should handle FHIR special versions', () => {
            test_getMajMin("r2", "1.0");
            test_getMajMin("r3", "3.0");
            test_getMajMin("r4", "4.0");
            test_getMajMin("r4B", "4.3");
            test_getMajMin("r5", "5.0");
            test_getMajMin("r6", "6.0");
            test_getMajMin("R2", "1.0");
            test_getMajMin("R3", "3.0");
            test_getMajMin("R4", "4.0");
            test_getMajMin("R4B", "4.3");
            test_getMajMin("R5", "5.0");
            test_getMajMin("R6", "6.0");
        });
    });

    describe('getMajMinPatch', () => {
        test('should extract major.minor.patch from standard semver', () => {
            test_getMajMinPatch("1.0.0", "1.0.0");
            test_getMajMinPatch("2.1.3", "2.1.3");
            test_getMajMinPatch("10.5.2", "10.5.2");
        });

        test('should extract major.minor.patch with prerelease', () => {
            test_getMajMinPatch("1.0.0-alpha", "1.0.0");
            test_getMajMinPatch("2.1.0-beta.1", "2.1.0");
            test_getMajMinPatch("3.2.5-rc.2", "3.2.5");
        });

        test('should default patch to 0 for two-part versions', () => {
            test_getMajMinPatch("1.0", "1.0.0");
            test_getMajMinPatch("2.5", "2.5.0");
        });

        test('should return null for single-part versions', () => {
            test_getMajMinPatch("1", null);
            test_getMajMinPatch("5", null);
        });

        test('should handle FHIR special versions', () => {
            test_getMajMinPatch("r2", "1.0.2");
            test_getMajMinPatch("r3", "3.0.2");
            test_getMajMinPatch("r4", "4.0.1");
            test_getMajMinPatch("r4B", "4.3.0");
            test_getMajMinPatch("r5", "5.0.0");
            test_getMajMinPatch("r6", "6.0.0");
        });
    });

    describe('getPatch', () => {
        test('should extract patch from standard semver', () => {
            test_getPatch("1.0.0", "0");
            test_getPatch("2.1.3", "3");
            test_getPatch("1.2.15", "15");
        });

        test('should extract patch with prerelease', () => {
            test_getPatch("1.0.0-alpha", "0");
            test_getPatch("2.1.5-beta.1", "5");
            test_getPatch("3.2.10-rc.2", "10");
        });

        test('should default patch to 0 for two-part versions', () => {
            test_getPatch("1.0", "0");
            test_getPatch("2.5", "0");
        });

        test('should throw for single-part versions', () => {
            expect(() => VersionUtilities.getPatch("1")).toThrow(FHIRException);
            expect(() => VersionUtilities.getPatch("5")).toThrow(FHIRException);
        });

        test('should handle FHIR special versions', () => {
            test_getPatch("r2", "2");
            test_getPatch("r3", "2");
            test_getPatch("r4", "1");
            test_getPatch("r4B", "0");
            test_getPatch("r5", "0");
            test_getPatch("r6", "0");
        });
    });

    describe('version increment methods', () => {
        test('incMajorVersion should increment major and reset minor/patch', () => {
            test_incMajorVersion("1.0.0", "2.0.0");
            test_incMajorVersion("2.5.10", "3.0.0");
            test_incMajorVersion("10.20.30", "11.0.0");
            test_incMajorVersion("0.9.5", "1.0.0");
            test_incMajorVersion("1.0.0-alpha", "2.0.0");
            test_incMajorVersion("2.1.0-beta.1", "3.0.0");
            test_incMajorVersion("1.5", "2.0.0");
            test_incMajorVersion("3.0", "4.0.0");
        });

        test('incMinorVersion should increment minor and reset patch', () => {
            test_incMinorVersion("1.0.0", "1.1.0");
            test_incMinorVersion("2.5.10", "2.6.0");
            test_incMinorVersion("10.20.30", "10.21.0");
            test_incMinorVersion("1.0.0-alpha", "1.1.0");
            test_incMinorVersion("2.1.0-beta.1", "2.2.0");
            test_incMinorVersion("1.5", "1.6.0");
            test_incMinorVersion("3.0", "3.1.0");
        });

        test('incPatchVersion should increment patch', () => {
            test_incPatchVersion("1.0.0", "1.0.1");
            test_incPatchVersion("2.5.10", "2.5.11");
            test_incPatchVersion("10.20.30", "10.20.31");
            test_incPatchVersion("1.0.0-alpha", "1.0.1");
            test_incPatchVersion("2.1.0-beta.1", "2.1.1");
            test_incPatchVersion("1.5", "1.5.1");
            test_incPatchVersion("3.0", "3.0.1");
        });
    });

    describe('versionMatches', () => {
        test('should handle exact matches', () => {
            test_versionMatches("2.0", "2.0", true);
            test_versionMatches("2.0.0", "2.0.0", true);
            test_versionMatches("1.5.3", "1.5.3", true);
            test_versionMatches("r4", "r4", true);
            test_versionMatches("R5", "r5", true);

            test_versionMatches("2.0", "2.0.0", false);
            test_versionMatches("2.0", "2.0.1", false);
            test_versionMatches("2.0.0", "2.0.1", false);
            test_versionMatches("2.0.0", "2.0.0-something", false);
            test_versionMatches("2.0.0", "2.0.0+something", false);
        });

        test('should handle star wildcards', () => {
            test_versionMatches("2.*", "2.0", true);
            test_versionMatches("2.*", "2.1", true);
            test_versionMatches("2.*", "2.99", true);
            test_versionMatches("2.*", "2.0.0", false);
            test_versionMatches("2.*", "2.1-something", false);
            test_versionMatches("2.*", "3.0", false);

            test_versionMatches("2.0.*", "2.0.0", true);
            test_versionMatches("2.0.*", "2.0.1", true);
            test_versionMatches("2.0.*", "2.0.99", true);
            test_versionMatches("2.0.*", "2.0.0-something", false);
            test_versionMatches("2.0.*", "2.0.0+something", false);
            test_versionMatches("2.0.*", "2.1.0", false);

            test_versionMatches("2.0.0-*", "2.0.0-prerelease", true);
            test_versionMatches("2.0.0-*", "2.0.0-alpha", true);
            test_versionMatches("2.0.0-*", "2.0.0-beta.1", true);
            test_versionMatches("2.0.0-*", "2.0.0+build", false);
            test_versionMatches("2.0.0-*", "2.0.0", false);

            test_versionMatches("2.0.0+*", "2.0.0+build", true);
            test_versionMatches("2.0.0+*", "2.0.0+anything", true);
            test_versionMatches("2.0.0+*", "2.0.0+build.123", true);
            test_versionMatches("2.0.0+*", "2.0.0", false);
            test_versionMatches("2.0.0+*", "2.0.0-prerelease", false);
        });

        test('should handle x/X wildcards', () => {
            test_versionMatches("2.x", "2.0", true);
            test_versionMatches("2.x", "2.1", true);
            test_versionMatches("2.x", "2.0.0", false);
            test_versionMatches("2.X", "2.0", true);
            test_versionMatches("2.X", "2.1", true);
            test_versionMatches("2.X", "2.0.0", false);
            test_versionMatches("2.0.x", "2.0.0", true);
            test_versionMatches("2.0.X", "2.0.1", true);

            test_versionMatches("2.0.0-x", "2.0.0-x", true);
            test_versionMatches("2.0.0-x", "2.0.0-y", false);
            test_versionMatches("2.0.0+X", "2.0.0+X", true);
            test_versionMatches("2.0.0+X", "2.0.0+Y", false);
        });

        test('should handle question mark prefix matching', () => {
            test_versionMatches("2.0?", "2.0", true);
            test_versionMatches("2.0?", "2.0.1", true);
            test_versionMatches("2.0?", "2.0.0-build", true);
            test_versionMatches("2.0?", "2.0.1+build", true);
            test_versionMatches("2.0?", "2.1", false);

            test_versionMatches("2.0.1?", "2.0.1", true);
            test_versionMatches("2.0.1?", "2.0.1-release", true);
            test_versionMatches("2.0.1?", "2.0.1+build", true);
            test_versionMatches("2.0.1?", "2.0.2", false);
        });

        test('should handle error conditions', () => {
            expect(() => VersionUtilities.versionMatches(null, "1.0.0")).toThrow(FHIRException);
            expect(() => VersionUtilities.versionMatches("1.0.0", null)).toThrow(FHIRException);
            expect(() => VersionUtilities.versionMatches("", "1.0.0")).toThrow(FHIRException);
            expect(() => VersionUtilities.versionMatches("1.0.0", "")).toThrow(FHIRException);
        });
    });

    describe('FHIR version checks', () => {
        test('isR5Plus should identify R5+ versions', () => {
            test_isR5Plus("r5", true);
            test_isR5Plus("R5", true);
            test_isR5Plus("r6", true);
            test_isR5Plus("5.0.0", true);
            test_isR5Plus("6.0.0", true);
            test_isR5Plus("4.5.0", true);
            test_isR5Plus("r4", false);
            test_isR5Plus("r4B", false);
            test_isR5Plus("4.0.0", false);
            test_isR5Plus("4.4.0", false);
        });

        test('isR4Plus should identify R4+ versions', () => {
            test_isR4Plus("r4", true);
            test_isR4Plus("R4", true);
            test_isR4Plus("r4B", true);
            test_isR4Plus("r5", true);
            test_isR4Plus("r6", true);
            test_isR4Plus("4.0.0", true);
            test_isR4Plus("4.1.0", true);
            test_isR4Plus("5.0.0", true);
            test_isR4Plus("3.2.0", true);
            test_isR4Plus("r3", false);
            test_isR4Plus("3.0.0", false);
            test_isR4Plus("3.1.0", false);
        });

        test('isR6Plus should identify R6+ versions', () => {
            test_isR6Plus("r6", true);
            test_isR6Plus("R6", true);
            test_isR6Plus("6.0.0", true);
            test_isR6Plus("r5", false);
            test_isR6Plus("r4", false);
            test_isR6Plus("5.0.0", false);
            test_isR6Plus("4.0.0", false);
        });
    });

    describe('removeVersionFromCanonical', () => {
        test('should remove version from canonical URLs', () => {
            test_removeVersionFromCanonical("http://example.com/CodeSystem|1.0.0", "http://example.com/CodeSystem");
            test_removeVersionFromCanonical("http://hl7.org/fhir/CodeSystem/test|2.1.5", "http://hl7.org/fhir/CodeSystem/test");
            test_removeVersionFromCanonical("http://test.org/cs|r4", "http://test.org/cs");
        });

        test('should handle URLs without versions', () => {
            test_removeVersionFromCanonical("http://example.com/CodeSystem", "http://example.com/CodeSystem");
            test_removeVersionFromCanonical("http://hl7.org/fhir/CodeSystem/test", "http://hl7.org/fhir/CodeSystem/test");
        });

        test('should handle edge cases', () => {
            test_removeVersionFromCanonical("|1.0.0", "");
            test_removeVersionFromCanonical("test|", "test");
            test_removeVersionFromCanonical("", "");
            test_removeVersionFromCanonical(null, null);
        });
    });

    describe('compareVersions', () => {
        test('should handle equal versions', () => {
            test_compareVersions("1.0.0", "1.0.0", 0);
            test_compareVersions("2.1.5", "2.1.5", 0);
            test_compareVersions("r4", "r4", 0);
            test_compareVersions("R5", "r5", 0);
        });

        test('should handle first version later', () => {
            test_compareVersions("1.0.1", "1.0.0", 1);
            test_compareVersions("1.1.0", "1.0.0", 1);
            test_compareVersions("2.0.0", "1.0.0", 1);
            test_compareVersions("r5", "r4", 1);
            test_compareVersions("2.1.0", "2.0.5", 1);
        });

        test('should handle second version later', () => {
            test_compareVersions("1.0.0", "1.0.1", -1);
            test_compareVersions("1.0.0", "1.1.0", -1);
            test_compareVersions("1.0.0", "2.0.0", -1);
            test_compareVersions("r4", "r5", -1);
            test_compareVersions("2.0.5", "2.1.0", -1);
        });

        test('should handle prerelease versions', () => {
            test_compareVersions("1.0.0", "1.0.0-alpha", 1);
            test_compareVersions("1.0.0-alpha", "1.0.0-beta", -1);
            test_compareVersions("1.0.0-beta", "1.0.0-alpha", 1);
        });
    });

    describe('versionHasWildcards', () => {
        test('should return false for null and empty inputs', () => {
            expect(VersionUtilities.versionHasWildcards(null)).toBe(false);
            expect(VersionUtilities.versionHasWildcards("")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("   ")).toBe(false);
        });

        test('should return false for regular semver versions', () => {
            expect(VersionUtilities.versionHasWildcards("1.0.0")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("2.1.5")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("10.20.30")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0-alpha")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0+build")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0-alpha+build")).toBe(false);
        });

        test('should return true for question mark suffix wildcard', () => {
            expect(VersionUtilities.versionHasWildcards("1.0?")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("2.1.0?")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.0-alpha?")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.0+build?")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("?")).toBe(true);
        });

        test('should return true for asterisk wildcard anywhere', () => {
            expect(VersionUtilities.versionHasWildcards("*.0.0")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.*.0")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.*")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("*.*.*")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.0-*")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.0-alpha*")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.0-*alpha")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.0+*")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.0+build*")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.0+*build")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("*")).toBe(true);
        });

        test('should return true for x/X wildcards in version parts', () => {
            expect(VersionUtilities.versionHasWildcards("x.0.0")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.x.0")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.x")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("x.x.x")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("X.0.0")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.X.0")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.X")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("X.X.X")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("x.X.0")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("X.x.0")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("x")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("X")).toBe(true);
        });

        test('should return false for x/X in release labels', () => {
            expect(VersionUtilities.versionHasWildcards("1.0.0-x")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0-X")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0-alpha-x")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0-x-alpha")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0-prex")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0-xpost")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0-preX")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0-Xpost")).toBe(false);
        });

        test('should return false for x/X in build labels', () => {
            expect(VersionUtilities.versionHasWildcards("1.0.0+x")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0+X")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0+build-x")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0+x-build")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0+prebuildx")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0+xpostbuild")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0+prebuildX")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0+Xpostbuild")).toBe(false);
        });

        test('should handle complex cases with both release and build labels', () => {
            expect(VersionUtilities.versionHasWildcards("x.0.0-alpha+build")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.x.0-alpha+build")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.X-alpha+build")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.0-x+X")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0-X+x")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("*.0.0-x+X")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.0-x+X?")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("x.0.0-*+build")).toBe(true);
        });

        test('should handle edge cases', () => {
            expect(VersionUtilities.versionHasWildcards("-")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("+")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("-+")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("+-")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("*-")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("*+")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("x-")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("X+")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.x.0.0")).toBe(true);
            expect(VersionUtilities.versionHasWildcards("1.0.0.0-x")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.0.0?-alpha")).toBe(false);
            expect(VersionUtilities.versionHasWildcards("1.?0.0")).toBe(false);
        });
    });

    // Helper methods
    function test_isSemVer(version, expected) {
        expect(VersionUtilities.isSemVer(version)).toBe(expected);
    }

    function test_isThisOrLaterMajorMinor(test, current, expected) {
        expect(VersionUtilities.isThisOrLater(test, current, VersionPrecision.MINOR)).toBe(expected);
    }

    function test_isThisOrLater(test, current, expected) {
        expect(VersionUtilities.isThisOrLater(test, current, VersionPrecision.FULL)).toBe(expected);
    }

    function test_getMajMin(input, expected) {
        expect(VersionUtilities.getMajMin(input)).toBe(expected);
    }

    function test_getMajMinPatch(input, expected) {
        expect(VersionUtilities.getMajMinPatch(input)).toBe(expected);
    }

    function test_getPatch(input, expected) {
        expect(VersionUtilities.getPatch(input)).toBe(expected);
    }

    function test_incMajorVersion(input, expected) {
        expect(VersionUtilities.incMajorVersion(input)).toBe(expected);
    }

    function test_incMinorVersion(input, expected) {
        expect(VersionUtilities.incMinorVersion(input)).toBe(expected);
    }

    function test_incPatchVersion(input, expected) {
        expect(VersionUtilities.incPatchVersion(input)).toBe(expected);
    }

    function test_versionMatches(criteria, candidate, expected) {
        expect(VersionUtilities.versionMatches(criteria, candidate)).toBe(expected);
    }

    function test_isR4Plus(version, expected) {
        expect(VersionUtilities.isR4Plus(version)).toBe(expected);
    }

    function test_isR5Plus(version, expected) {
        expect(VersionUtilities.isR5Plus(version)).toBe(expected);
    }

    function test_isR6Plus(version, expected) {
        expect(VersionUtilities.isR6Plus(version)).toBe(expected);
    }

    function test_removeVersionFromCanonical(input, expected) {
        expect(VersionUtilities.removeVersionFromCanonical(input)).toBe(expected);
    }

    function test_compareVersions(ver1, ver2, expected) {
        expect(VersionUtilities.compareVersions(ver1, ver2)).toBe(expected);
    }
});