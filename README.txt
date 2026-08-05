FLIGHTY LOGBOOK CONVERTER — IPHONE WEB APP

WHAT THIS IS
A static web app that runs in Safari. Your Flighty CSV is processed in the browser and is not uploaded to a server. The app downloads a public airport database and JavaScript libraries from the internet.

FASTEST WAY TO PUT IT ON YOUR IPHONE (FREE GITHUB PAGES)
1. Create a free GitHub account at github.com.
2. Create a new PUBLIC repository named flighty-logbook-converter.
3. Upload every file from this folder to the repository root.
4. Open repository Settings > Pages.
5. Under Build and deployment, choose “Deploy from a branch.”
6. Select branch “main” and folder “/(root),” then Save.
7. GitHub will show the website address after deployment.
8. Open that address in Safari on your iPhone.
9. Tap Share > Add to Home Screen > Add.

USING THE APP
1. Export flights from Flighty as CSV and save the file in the iPhone Files app.
2. Open Flighty Logbook from the Home Screen.
3. Tap Choose Flighty CSV and select the export.
4. Select PIC or SIC and the night-time offset.
5. Tap Convert Flights.
6. Tap Save Excel or Save CSV and choose Save to Files.

IMPORTANT
- Internet access is needed the first time and whenever the airport database is refreshed.
- Review results before using them as an official pilot logbook record.
- Night-time estimation samples the aircraft’s great-circle route minute by minute. It is an estimate, not an FAA-endorsed electronic logbook system.
- Diverted flights keep the scheduled “To” airport in the output and include the diversion in Remarks, while using the actual diversion airport for time-zone, sunset, and landing calculations.

FILES
index.html              Main app page
app.js                  Conversion logic
styles.css              Mobile design
manifest.webmanifest    Home Screen app settings
service-worker.js       Caches the app shell
icon.svg                Home Screen icon
SAMPLE-FlightyExport.csv Test file
