# Weyland-Yutani Asset Label Generator

A Tissue Cell that generates sci-fi industrial asset labels for the Weyland-Yutani Corporation, inspired by the Alien movie trilogy.

## Features

- **Authentic Weyland-Yutani Branding**: Winged sun logo, "Building Better Worlds" slogan
- **Sci-Fi Asset Tracking**: Asset IDs (WY-XXXX-XXX), product names, colony/facility locations
- **Hazard Classification System**: MINIMAL, MODERATE, EXTREME, BIOHAZARD, QUARANTINE
- **Dark Industrial Theme**: Always dark mode with amber/gold accents
- **B&W Print Mode**: Simple checkbox to convert label to grayscale for monochrome printing
- **QR Code Generator**: Standard QR with debugging console output
- **40+ Alien Universe Products**: Atmosphere Processors, Power Loaders, Motion Trackers, MU-TH-UR interfaces, Colonial Marine weapons
- **Iconic Locations**: Hadley's Hope, LV-426, Fury 161, Sevastopol Station, Gateway Station
- **Character References**: Ripley, Hicks, Bishop, crew of the Nostromo and Sulaco

## Deploy

```bash
ribo deploy
```

## Usage

1. Enter a URL or tracking data to encode in the QR code
2. Fill in the asset fields (or click "Randomize" for Alien universe data)
3. Customize QR code shape and colors
4. Click "Generate Label" to update the preview
5. Print or download the label as PNG

## Label Fields

| Field | Example |
|-------|---------|
| **Asset ID** | WY-2187-842 |
| **Product** | Atmosphere Processing Unit |
| **Facility** | Hadley's Hope |
| **Location** | Sector 7G // Operations |
| **Operator** | Ripley, E. - WY-0451 |
| **Manifest** | USCSS-NOSTROMO-1802 |
| **Status** | OPERATIONAL |
| **Mass / Specs** | 2.4 MT // 4.2x3.1x2.8m |
| **Hazard Class** | MODERATE HAZARD |

## Hazard Classes & Colors

| Class | Color | Use Case |
|-------|-------|----------|
| MINIMAL | Green | Routine equipment |
| MODERATE | Amber | Industrial machinery |
| EXTREME | Red | Hazardous materials |
| BIOHAZARD | Purple | Containment areas |
| QUARANTINE | Black/Red | Lockdown situations |

## Sample Products

- Atmosphere Processing Unit
- Power Loader P-5000
- Cryo-Stasis Pod
- MU-TH-UR 6000 Interface
- Motion Tracker M314
- M41A Pulse Rifle
- UA 571-C Sentry Gun
- Colonial Marine Smartgun
- Seismic Survey Equipment
- Terraforming Controller

## Sample Colonies & Stations

- Hadley's Hope (Acheron/LV-426)
- Fury 161
- Gateway Station
- Sevastopol Station
- Anchorpoint Station
- Freya's Prospect
- New Galveston

## Sample Crew/Operators

- Ripley, E. - WY-0451
- Dallas, A. - WY-0001
- Hicks, D. - USCM-777
- Vasquez, J. - USCM-469
- Bishop - WY-3412
- Newt - CIV-2187

## Label Sizes

Three label sizes are available:

| Size | Dimensions | Layout | Use Case |
|------|------------|--------|----------|
| **Default** | 600px wide | Full data table + QR | Standard display |
| **50x30mm** | 590 x 354 px @ 300dpi | Asset/Product/Serial on left, QR on right, no banner | Industrial compact |
| **20x30mm** | 236 x 354 px @ 300dpi | QR only, enlarged | Minimal footprint |

Note: 50x30mm and 20x30mm hide the hazard banner. 20x30mm is QR-only.

## QR Code Styling

Customize QR appearance with:

| Option | Choices |
|--------|---------|
| **Dots Style** | Square, Rounded, Dots, Classy, Classy Rounded |
| **Corner Style** | Square, Rounded, Circle, Extra Rounded |
| **Corner Dot** | Square, Rounded, Circle |

The finder patterns (corner squares) and data dots can each have different shapes.

## Debugging

Open browser console (F12) to see detailed debug output from the QR code generator. Look for messages tagged with `[DEBUG]` and `[ERROR]`.

## Note

This is a fan-made prop/parody tool inspired by the Alien film franchise. Weyland-Yutani and related terms are trademarks of 20th Century Studios. Not for commercial use.
