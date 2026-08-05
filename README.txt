FLIGHTY IPHONE LOGBOOK CONVERTER — VERSION 3

THIS VERSION FIXES TIME ZONES DIFFERENTLY:
- It does NOT guess time zones from coordinates in Safari.
- It includes airports.csv, the same airport/IANA time-zone database used by the working desktop converter.
- It disables the old service worker cache.
- The preview shows the detected time zones for every flight.

UPLOAD / UPDATE
1. Delete the old files from your GitHub Pages repository.
2. Upload ALL files from this folder, especially airports.csv.
3. Commit the changes.
4. Wait for GitHub Pages to deploy.
5. On iPhone, delete the old Home Screen icon.
6. Safari: Settings > Apps > Safari > Advanced > Website Data. Search for your GitHub Pages site and delete its saved data.
7. Open the site again in Safari. Confirm it says VERSION 3.0 BUNDLED TIME ZONES.
8. Add it to the Home Screen again.

TEST
For the included sample, the first MIA to EIS/SJU row should show:
- Time zones: America/New_York -> America/Puerto_Rico
- Total time: 3:38

If it does not, take a screenshot of the first row including the Time zones column.
