const {Providers} = require("../../tx/provider");
const path = require("path");

describe('Provider Test', () => {

  test('Full tx.fhir.org load', async () => {
    let configFile = path.resolve(__dirname, '../../tx/tx.fhir.org.yml')
    let providers = new Providers(configFile);
    await providers.load();
    expect(providers.codeSystemFactories.size).toBeGreaterThan(0);
    expect(providers.codeSystems.size).toBeGreaterThan(0);
    expect(providers.valueSetProviders.length).toBeGreaterThan(0);

    let r4 = await providers.cloneWithFhirVersion("r4");

    expect(r4.codeSystemFactories.size).toEqual(providers.codeSystemFactories.size);
    expect(r4.codeSystems.size).toBeGreaterThan(providers.codeSystems.size);
    expect(r4.valueSetProviders.length).toBeGreaterThan(providers.valueSetProviders.length);

  }, 5000000);
});