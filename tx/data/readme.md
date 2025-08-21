= Introduction =

This file contains testing material for the code systems.
Generally, the data in here is used during the unit tests
to:

a. import the terminology 
b. test the terminology provider 

What follows is notes about how to prepare the subsets

== SNOMED CT ==

Take an international SNOMED distribution, and run:

```
java -jar --add-opens java.base/java.lang=ALL-UNNAMED snomed-owl-toolkit-5.3.0-executable.jar \
 -rf2-to-owl -rf2-snapshot-archives {zip-download} -version 20250801
java -jar --add-opens java.base/java.lang=ALL-UNNAMED snomed-subontology-extraction-2.2.0-SNAPSHOT-executable \
 -source-ontology ontology-20250801.owl -input-subset {subset.txt} -output-rf2 -rf2-snapshot-archive {zip-download} -include-inactive
```

== LOINC CT ==

The subset is prepared by running

```
tx-import loinc-subset
```

You then have to provide a reference to a LOINC source, 
and a list of LOINC codes to import, which is found in
loinc-subset.txt

== NDC ==

The test set is prepared by hand by taking subsets
from the first few lines of NDC

== UCUM ==

Just use the ucum-essence file from the official UCUM
distribution directly.