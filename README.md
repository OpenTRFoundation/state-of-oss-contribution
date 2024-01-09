# OpenTR - State of Open Source Contribution in Turkey - Data

This repository contains the data used in the OpenTR's [State of Open Source Contribution in Turkey](https://state.opentr.foundation/) report.

Data from GitHub is collected using [Cuttlecat](https://github.com/OpenTRFoundation/cuttlecat) and stored in the repository.

Later on, these data is processed and used to generate the report.

To see the report, visit [https://state.opentr.foundation](https://state.opentr.foundation/).

# Implementation

The report is constructed using multiple phases in 2 different repositories.

The data collection and processing is done in this repository.

The report generation is done in [OpenTRFoundation/state-of-oss-contribution-report](https://github.com/OpenTRFoundation/state-of-oss-contribution-report) repository.

## Data Collection

The `src` folder contains the data collection scripts and [`cuttlecat`](https://github.com/OpenTRFoundation/cuttlecat) commands.

- [100-focus-project-candidate-search](100-focus-project-candidate-search): Contains the data collected from GitHub using Cuttlecat for focus project candidates.
- [200-focus-project-extract](200-focus-project-extract): Contains the data extracted from the focus project candidates. This directory contains the focus organizations and focus repositories.
- [250-location-generation](250-location-generation): Contains the location data (provinces and districts). This directory contains both the inputs and the outputs.
- [300-user-count-search](300-user-count-search): Contains the data collected from GitHub using Cuttlecat for user counts for locations.
- [400-user-and-contrib-search](400-user-and-contrib-search): Contains the data collected from GitHub using Cuttlecat for users and their contributions.

## Data Processing

- [900-report-data-truthmap](900-report-data-truthmap): This directory contains the truthmap data that's built using the data previously collected from GitHub.
- [910-debug-data](910-debug-data): Similar to the truthmaps, this directory contains the debug data that's built using the data previously collected from GitHub. Contents of this directory are not used in the report, but they're for sanity checks.
- [990-report-data](990-report-data): This directory contains the data that's used in the report. This data is built using the truthmaps built earlier.

## Report Generation

To see how the report works with the data prepared here, visit [OpenTRFoundation/state-of-oss-contribution-report](https://github.com/OpenTRFoundation/state-of-oss-contribution-report) repository.

## TODOs

- Weighted contribution score for users and companies, based on the diversity of the projects they contribute to.
- Weighted contribution score for users and companies, based on the project's popularity.
