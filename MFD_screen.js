// 1. Create the Timer object using a class
class Timer {
    constructor(duration) {
        this.ON = false;         // Boolean: is the timer running?
        this.duration = duration; // Total time (e.g., in seconds)
        this.count = 0;          // Current elapsed time
        this.timerId = null;     // internal reference for setInterval
    }

    // 2. Add a method to start the timer
    start() {
        if (!this.ON) {
            this.ON = true;
            this.count = 0;
            this.timerId = setInterval(() => {
                this.count++;
                console.log("Time elapsed: " + this.count);

                if (this.count >= this.duration) {
                    this.stop();
                    console.log("Timer finished!");
                }
            }, 1000); // 1000ms = 1 second
        }
    }

    // 3. Add a method to stop the timer
    stop() {
        this.ON = false;
        clearInterval(this.timerId); // Built-in JS function to stop the interval
    }

}

class MFD_screen extends BaseInstrument {

    constructor() {
        super();

        this.HdgTrk = 0; // 0=magnetic display, 1=track up
        this.lastInteractionTime = Date.now();
        this.optionsAutoCloseMs = 60000; // auto close time for options menu

        this.mfdPoweredLast = null;
        this.hasBeenPowered = false;
        this.initScreenActive = false;
        this.initScreenStartMs = 0;
        this.initScreenDurationMs = 10000;
        this.screenBrightness = 1.0;//full bright
        this.MFD_dimming = Number(SimVar.GetSimVarValue("L:MFD_Dim.1", "Number"));
        if (!Number.isFinite(this.MFD_dimming)) this.MFD_dimming = 0;
        this.avionicsON = true;
        this.pfdPowered = true;
        this.mfdPowered = true;

        // Smoothed wind display state (copied from PFD_screen)
        this.windSampleIntervalMs = 500;     // sample twice per second
        this.windAverageWindowMs = 15000;    // 15-second average
        this.windSamples = [];               // [{ t, dir, spd }]
        this.windDisplayDirection = 0;
        this.windDisplaySpeed = 0;
        this.windDirection = 0;
        this.windSpeed = 0;
        this._lastWindSampleMs = 0;
        this.miscOption = -1;
        this.windOption = 0;
        this.isOnGround = false;

        this.stayOnOverride = false;
        this.shutdownDelayMs = 30000;
        this.shutdownActive = false;
        this.shutdownComplete = false;
        this.shutdownStartMs = 0;
        this.shutdownRemainingMs = 0;
        this.preShutdownPage = "primary";

        // ---- Nearest airports cache / throttle ----
        this.nearestAirportMaxItems = 20;
        this.nearestTimer = 0;
        this.nearestIndex = 0;          // increments every call
        this.nearestAirportsDraw = []; // what you draw
        this.nearestAirportsWork = []; // what you fill
        this.nearestWorkValidCount = 0;
        this.nearestScanInProgress = false;


        SimVar.SetSimVarValue("L:MAPVIEW_VISIBLE", "Number", 1);//allways on

        this.TRKbox_timer = new Timer(10); // Initialize with a 10-second duration
        this.map = null;
        this.mapScaleTweak = 1.2;// Tweak factor for map scaling to better fit the display

        // options menu scrolling state
        this.optionsScroll = 0;      // index in optionsRoot of top visible row
        this.optionsVisibleRows = 3; // btn_1 + btn_2 + btn_3
        this.optionsSelIndex = 1;
        this.showOptions = false;
        this.optionsLevel = 0;   // 0 = root, 1 = child
        this.optionsParent = ""; // which root category we are in
        this.optionsEditing = false;
        this.optionsEditKey = "";
        this.lastSmallKnobTime = 0;
        this.cdiVdiPreviewOn = true;
        this.locCdiPromptOn = true;
        this.optionsBackLabel = "Back";
        this.optionsRoot = [
            "CRS Options",
            "TRK Options",
            "CDI/VDI Preview",
            "LOC CDI Prompt",
            "Bearing 1",
            "Bearing 2",
            "Misc. Field",
            "Backlight"
        ];

        this.optionsChildren = {
            "CRS Options": ["CRS"],
            "TRK Options": ["TRK"],
            "Misc. Field": ["Off", "TAS", "GS", "OAT", "Wind", "Wind Settings"],
            "Wind Settings": ["<-MPH ^MPH", "DEG MPH", "<- MPH"],
            "Backlight": ["Brighter", "Dimmer"]
        };

        // Maps a "Misc. Field" menu label to its this.miscOption numeric value.
        this.miscFieldMapping = { "TAS": 0, "GS": 1, "OAT": 2, "Wind": 3 };
        // Maps a "Wind Settings" menu label to its this.windOption numeric value.
        this.windFieldMapping = { "<-MPH ^MPH": 0, "DEG MPH": 1, "<- MPH": 2 };
        // this.miscOption / this.windOption are read each tick from L:MFD_Misc.1 /
        // L:MFD_Wind_Style.1 (see getSimVars) which persist across flights via the
        // LocalVar/LocalVarDefault entries added to systems.cfg.
        this.menuHistory = []; // Stores previous menu parents for nested submenu back-navigation

        // Default page and supported pages
        this.currentPage = "primary"; // Default page.
        this.pages = ["primary", "map", "adi"]; // Pages supported by the MFD.
        this.pageDotsTimeout = null; // Timeout handler for hiding the page dots
        this.pageDotsVisible = false;

        this.lightBlue = "#26c6ff";
        this.magenta = "#ff00ff";
        this.mapRange = 80; // Map range radius in NM
        this.visibleMapRange = 48;

        // --- preview CDI/VDI ---
        this.isPreviewActive = false;       // True if a valid preview source is found
        this.previewCdiDeflection = 0;      // The CDI deflection for the preview
        this.previewVdiDeflection = 0;      // The VDI deflection for the preview
        this.previewVtgValid = false;       // True if the preview source has a valid GS
        this.previewToFrom = 0;             // The TO/FROM flag for the preview

        // Navigation data
        this.finalApproachCourseDeg = null;   // true course FAF -> runway
        this.inboundToFaf = false;
        this.locCdiPromptActive = false;
        this.locCdiPromptFlash = false;
        this.locCdiPromptLastBlinkMs = 0;
        this.locCdiPromptBlinkPeriodMs = 500;

        this.approachWaypoints = [];
        this.fafWaypoint = null;
        this.distanceToFafNm = null;

        this.apprCourse = 0;
        this.flightPlanWaypoints = []; // Array for flight plan waypoints
        this.activeWaypointIndex = -1;
        this.previousWaypointLat = 0;
        this.previousWaypointLon = 0;
        this.nextWaypointLat = 0;
        this.nextWaypointLon = 0;
        this.nextNextWaypointLat = 0;
        this.nextNextWaypointLon = 0;
        this.airplaneLat = 0;
        this.airplaneLon = 0;
        this.flightPlanData;

        this.RMI1Source = 2; // 0=none, 1=GPS, 2=VOR1 (default)
        this.RMI2Source = 2; // 0=none, 1=GPS, 2=VOR2 (default)
        this.bearing1 = NaN;
        this.bearing2 = NaN;
        this.knobLongPressTimer = null;
        this.knobLongPressFired = false;
        // Hardware knob: swallow the short-press LVar the knob emits with/after a long press
        this.knobShortSuppressMs = 2000;
        this._knobShortSuppressUntil = 0;
        this.touchedBox = null;
        this.knobHoldTimer = null;
        this.debugText = "TEST";
        this.debugInt = 0;
        this.knobPressStart = null;
        this.heading = 0;
        this.trackMag = 0;
        this.trkSel = 0;
        this.trkHold = false;
        this.crsSel = 0;
        this.hdgSel = 0;
        this.groundTrack = 0;
        this.activeBox = "trk";
        this.cdiDeflection = 0;
        this.gpsDrivesNav1 = false;
        this.gpsObsActive = false;
        this.WPdirect = false; // true when GPS selected, OBS off, and a Direct-To course is active
        this.hsiBearing = 0;
        this.crsLock = false;
        this.toFromFlag = 1;    //0-OFF, 1-TO,2-FROM
        this.selectedNavSource = "VOR1"; // Default to VOR1 for ILS test
        this.lastNavSource = "VOR1";  // or NAV2 if you prefer
        this.gpsHasGP = false;
        this.nav1loc = false;
        this.nav2loc = false;

        this.waypointIdent = "";
        this.identColor = "#e049b0";
        this.phaseText = "";
        this.distanceToNext = "";
        this.eteToNext = "";
        this.eteToNextStr = "";

        this.navSourceText = ""; // <-- Use this for display!
        this.vtgType = ""; // "GS", "GP", "VNAV", ""
        this.vtgValid = false;
        this.vtgDeflection = 0;

        //options buttons size/location
        const bx = 60;
        const by = 205;
        const bw = 65; // button width
        const bh = 60; // button height
        const pad = 2; // button pad

        this.touchBoxes = [
            // HSI BOX TOUCHBOXES
            { id: "trk", x: 90, y: 220, w: 40, h: 40 },//0
            { id: "crs", x: 190, y: 220, w: 40, h: 40 },//1
            { id: "cdi", x: 140, y: 230, w: 40, h: 30 },//2
            // map touch box
            { id: "map_range", x: 40, y: 150, w: 45, h: 18 },//3
            // BEZEL KNOB TOUCHBOXES
            // Large knob
            { id: "large_knob_cw", x: 0, y: 265, w: 20, h: 40 },//4
            { id: "large_knob_ccw", x: 50, y: 265, w: 20, h: 40 },//5
            // Small knob
            { id: "small_knob_cw", x: 20, y: 265, w: 30, h: 10 },//6
            { id: "small_knob_ccw", x: 20, y: 295, w: 30, h: 10 },//7
            // Small knob button
            { id: "small_knob_button", x: 25, y: 280, w: 18, h: 10 },//8
            //options touchboxes
            { id: "options_back", x: 62, y: 35, w: 65, h: 55 },//9
            { id: "options_btn_1", x: bx, y: by, w: bw, h: bh },//10
            { id: "options_btn_2", x: bx + bw + pad, y: by, w: bw, h: bh },//11
            { id: "options_btn_3", x: bx + 2 * (bw + pad), y: by, w: bw, h: bh },//12
            //ADI page touchboxes
            { id: "spd", x: 0, y: 65, w: 85, h: 20 },//13
            { id: "alt", x: 220, y: 65, w: 85, h: 20 },//14
            { id: "baro", x: 235, y: 208, w: 80, h: 20 },//15
            { id: "hdg", x: 0, y: 208, w: 80, h: 20 },//16
            { id: "shutdown_now", x: 95, y: 160, w: 130, h: 32 },//17
            { id: "stay_on", x: 95, y: 198, w: 130, h: 32 },//18
        ];

        this.simFolder = "coui://html_ui/Pages/VCockpit/Instruments/MFD_screen/";
        this.localFolder = "images/MFD_screen/";
        this.images = {};

        const simMode = (typeof SimVar !== "undefined");
        const imageMap = [
            { key: "bezelImg", src: "Gi-275_attitude_bezel.png", sim: this.simFolder + "Gi-275_attitude_bezel.png" },
            { key: "compassImg", src: "compass_card.png", sim: this.simFolder + "compass_card.png" },
            { key: "hsiLayer2Img", src: "Gi-275_HSI_layer_2.png", sim: this.simFolder + "Gi-275_HSI_layer_2.png" },
            { key: "bugImg", src: "Gi-275_bug.png", sim: this.simFolder + "Gi-275_bug.png" },
            { key: "cdiVertImg", src: "CDI.png", sim: this.simFolder + "CDI.png" },
            { key: "circle", src: "circle.png", sim: this.simFolder + "circle.png" },
            { key: "options", src: "HSI_options.png", sim: this.simFolder + "HSI_options.png" },
            { key: "backlightImg", src: "backlight.png", sim: this.simFolder + "backlight.png" },
            { key: "horizonImg", src: "horizonbackground.png", sim: this.simFolder + "horizonbackground.png" },
            { key: "horizonNumbersImg", src: "horizonnumbers.png", sim: this.simFolder + "horizonnumbers.png" },
            { key: "bank_angleImg", src: "bank_angle.png", sim: this.simFolder + "bank_angle.png" },
            { key: "overlayImg", src: "Gi-275_attitude_overlay.png", sim: this.simFolder + "Gi-275_attitude_overlay.png" },
            { key: "fdImg", src: "Gi-275_attitude_FD.png", sim: this.simFolder + "Gi-275_attitude_FD.png" },
            { key: "tapeShadeImg", src: "Gi-275_attitude_tape_shade.png", sim: this.simFolder + "Gi-275_attitude_tape_shade.png" },
            { key: "altBugImg", src: "Gi-275_alt_bug.png", sim: this.simFolder + "Gi-275_alt_bug.png" },
            { key: "vdiImg", src: "VDI.png", sim: this.simFolder + "VDI.png" },
            { key: "cdiImg", src: "ADI_CDI.png", sim: this.simFolder + "ADI_CDI.png" },
            { key: "aptTower", src: "airport_tower.png", sim: this.simFolder + "airport_tower.png" },
            { key: "aptNoTower", src: "airport_nontower.png", sim: this.simFolder + "airport_nontower.png" },
            { key: "aptPrivate", src: "airport_private.png", sim: this.simFolder + "airport_private.png" },
            { key: "aptHelipad", src: "airport_helipad.png", sim: this.simFolder + "airport_helipad.png" },
        ];
        for (const entry of imageMap) {
            this.images[entry.key] = new Image();
            this.images[entry.key].onload = () => { this.Update && this.Update(); };
            this.images[entry.key].onerror = function () { console.log("Image load error:", this.src); };
            this.images[entry.key].src = simMode ? entry.sim : entry.src;
        }
        this.backlightImg = this.images.backlightImg;
        this.airportIcons = {
            tower: this.images.aptTower,
            nontower: this.images.aptNoTower,
            private: this.images.aptPrivate,
            helipad: this.images.aptHelipad
        };
    }




    //WTGarmin_LNavData_CDI_Scale_Label
    flightPhaseLabel(idx) {
        switch (idx) {
            case 0: return "DPRT";        // Departure
            case 1: return "TERM";        // Terminal
            case 2: return "TERM";        // TerminalDeparture
            case 3: return "TERM";        // TerminalArrival
            case 4: return "ENR";         // Enroute
            case 5: return "OCN";         // Oceanic
            case 6: return "LNAV";        // LNav
            case 7: return "LNAV+V";      // LNavPlusV
            case 8: return "APPR";        // Visual
            case 9: return "LNAV/V";   // LNavVNav
            case 10: return "LP";         // LP
            case 11: return "LP+V";       // LPPlusV
            case 12: return "LPV";        // LPV
            case 13: return "APR";        // Approach
            case 14: return "MAPR";       // MissedApproach
            case 15: return "MAPR";       // Missed Approach
            default: return "";
        }
    }

    get isInteractive() { return true; }
    get templateID() { return "MFD_screen_ID"; }

    getSimVars() {


        //SimVar.SetSimVarValue("L:timerON", "number", this.TRKbox_timer.ON());

        if (!this.TRKbox_timer.ON) this.activeBox = "trk";//reselect trk box after timer up

        if (typeof SimVar !== "undefined" && typeof SimVar.GetSimVarValue === "function") {

            this.screenBrightness = SimVar.GetSimVarValue("L:SCREEN_BRIGHT", "Number");

            this.airplaneLat = SimVar.GetSimVarValue("PLANE LATITUDE", "degrees");
            this.airplaneLon = SimVar.GetSimVarValue("PLANE LONGITUDE", "degrees");
            this.magVar = SimVar.GetSimVarValue("GPS MAGVAR", "degrees");//degrees;
            this.bearingToWP = SimVar.GetSimVarValue("GPS WP BEARING", "degrees");
            this.bearingToWP = (this.bearingToWP + this.magVar + 360) % 360;
            this.distanceToWP = SimVar.GetSimVarValue("GPS WP DISTANCE", "nautical miles");
            this.cdiNeedleValid = !!SimVar.GetSimVarValue("HSI CDI NEEDLE VALID", "Bool");
            const tasKts = SimVar.GetSimVarValue("AIRSPEED TRUE", "Knots");
            if (typeof tasKts === "number" && isFinite(tasKts)) {
                this.tasMph = Math.round(tasKts * 1.15078);
            } else {
                this.tasMph = null;
            }

            // --- Misc. Field selection + data sources (TAS above, plus GS/OAT/Wind) ---
            // Persisted via systems.cfg LocalVar/LocalVarDefault so the choice survives flights.
            this.miscOption = SimVar.GetSimVarValue("L:MFD_Misc.1", "number") || 0;
            this.windOption = SimVar.GetSimVarValue("L:MFD_Wind_Style.1", "number") || 0;

            // Use GROUND VELOCITY (airframe-level) rather than GPS GROUND SPEED, which
            // can read 0 without an active GPS flight plan.
            const gsKts = SimVar.GetSimVarValue("GROUND VELOCITY", "Knots");
            this.gsMph = (typeof gsKts === "number" && isFinite(gsKts)) ? Math.round(gsKts * 1.15078) : null;

            const oatC = SimVar.GetSimVarValue("AMBIENT TEMPERATURE", "celsius");
            this.oatC = (typeof oatC === "number" && isFinite(oatC)) ? Math.round(oatC) : null;

            this.isOnGround = !!SimVar.GetSimVarValue("SIM ON GROUND", "Bool");
            this.updateSmoothedWind();
            this.windDirection = this.windDisplayDirection || 0;
            this.windSpeed = this.windDisplaySpeed || 0;

            // Heading and basic nav flags
            this.heading = (SimVar.GetSimVarValue("PLANE HEADING DEGREES MAGNETIC", "degrees") || 0);
            this.trueHeading = (SimVar.GetSimVarValue("PLANE HEADING DEGREES TRUE", "degrees") || 0);
            this.nav1loc = !!SimVar.GetSimVarValue("NAV HAS LOCALIZER:1", "Bool");
            this.nav2loc = !!SimVar.GetSimVarValue("NAV HAS LOCALIZER:2", "Bool");
            this.nav1Codes = SimVar.GetSimVarValue("NAV CODES:1", "Number") || 0;
            this.nav2Codes = SimVar.GetSimVarValue("NAV CODES:2", "Number") || 0;

            // Track (heading-up)
            this.trackMag = SimVar.GetSimVarValue("GPS GROUND MAGNETIC TRACK", "degrees");
            if (this.tasMph < 40) this.trackMag = this.heading; // low speed fallback
            // Track (true-up)
            this.trackTrue = SimVar.GetSimVarValue("GPS GROUND TRUE TRACK", "degrees");
            if (this.tasMph < 40) this.trackTrue = this.heading; // low speed fallback
            SimVar.SetSimVarValue("L:TRACK_MAG", "Number", this.trackMag);

            // RMI bearings
            //1
            this.RMI1Source = SimVar.GetSimVarValue("L:RMI_SRC.1", "number");
            if (this.RMI1Source === 1) {
                const gpsBearing = SimVar.GetSimVarValue("GPS WP BEARING", "degrees");
                this.bearing1 = isFinite(gpsBearing) ? gpsBearing : NaN;
            } else if (this.nav1loc) {
                this.bearing1 = NaN;
            } else if (this.RMI1Source === 2) {
                const relBearing = SimVar.GetSimVarValue("NAV RELATIVE BEARING TO STATION:1", "degrees");
                this.bearing1 = (isFinite(relBearing) && relBearing !== 90)
                    ? ((this.heading + relBearing + 360) % 360)
                    : NaN;
            } else {
                this.bearing1 = NaN;
            }
            //2
            this.RMI2Source = SimVar.GetSimVarValue("L:RMI_SRC.2", "number");
            if (this.RMI2Source === 1) {
                const gpsBearing = SimVar.GetSimVarValue("GPS WP BEARING", "degrees");
                this.bearing2 = isFinite(gpsBearing) ? gpsBearing : NaN;
            } else if (this.nav2loc) {
                this.bearing2 = NaN;
            } else if (this.RMI2Source === 2) {
                const relBearing = SimVar.GetSimVarValue("NAV RELATIVE BEARING TO STATION:2", "degrees");
                this.bearing2 = (isFinite(relBearing) && relBearing !== 90)
                    ? ((this.heading + relBearing + 360) % 360)
                    : NaN;
            } else {
                this.bearing2 = NaN;
            }

            // Other SimVars
            this.groundTrack = ((SimVar.GetSimVarValue("GPS GROUND MAGNETIC TRACK", "radians") || 0) * 180 / Math.PI) % 360;
            this.gpsHasGP = !!SimVar.GetSimVarValue("GPS HAS GLIDEPATH", "Bool");
            this.trkSel = Number((SimVar.GetSimVarValue("L:TRK_SEL", "Number") || 0) + 360) % 360;
            this.trkHold = !!SimVar.GetSimVarValue("L:TRK_HOLD", "Bool") || 0;
            this.hdgSel = Number(SimVar.GetSimVarValue("AUTOPILOT HEADING LOCK DIR", "degrees") || 0);
            this.gpsObsActive = !!SimVar.GetSimVarValue("GPS OBS ACTIVE", "Bool");
            this.hsiBearing = ((SimVar.GetSimVarValue("HSI BEARING", "Degrees") || 0) + 360) % 360;
            this.cdiDeflection = Number(SimVar.GetSimVarValue("HSI CDI NEEDLE", "Number")) || 0;
            const APactiveVertical = SimVar.GetSimVarValue("L:PMS50_APGA_ACTIVE_VERTICAL_MODE", "Number");
            const AParmedVertical = SimVar.GetSimVarValue("L:PMS50_APGA_ARMED_VERTICAL_MODE", "Number");

            //Autotune and set course for ILS/LOC
            const aprMode = SimVar.GetSimVarValue("GPS APPROACH MODE", "Number");
            const stbyFrq = Number(SimVar.GetSimVarValue("NAV STANDBY FREQUENCY:1", "MHz"));
            const isLoc = SimVar.GetSimVarValue("NAV HAS LOCALIZER:1", "Bool");
            const apr_button = SimVar.GetSimVarValue("L:PMS50_APGA_APR_BUTTON_STATE", "Number");
            const dest_dist = SimVar.GetSimVarValue("L:DEST_DIST", "Number");
            const GPShasGP = SimVar.GetSimVarValue("GPS HAS GLIDEPATH", "Bool");

            // GPS = ILS/LOC and active FRQ is ILS/LOC and within 20NM, autoslew course
            if (aprMode === 2 && (this.navSourceText === "ILS1" || this.navSourceText === "LOC1") && dest_dist < 25) {// apr_button === 1) {
                SimVar.SetSimVarValue("K:VOR1_SET", "number", this.apprCourse);
            }

            // NAV source selection
            const simGpsDrivesNav1 = !!SimVar.GetSimVarValue("GPS DRIVES NAV1", "Bool");
            this.selectedNavSource = simGpsDrivesNav1 ? "GPS" : this.lastNavSource;
            this.toFromFlag = 1; // Always TO for GPS mode
            let phaseIdx = -1;

            // Desired track (DTK) from GPS leg
            let dtkRad = SimVar.GetSimVarValue("GPS WP DESIRED TRACK", "radians");
            let dtkDeg = ((dtkRad) * (180 / Math.PI));//degrees
            this.dtkDeg = (dtkDeg + 360) % 360;

            // CRS/course logic + WPdirect detection
            if (this.selectedNavSource === "GPS") {
                this.gpsDrivesNav1 = true;
                this.waypointIdent = SimVar.GetSimVarValue("GPS WP NEXT ID", "string") || "";
                this.navAvail = true;

                if (this.gpsObsActive) {
                    // OBS typed course
                    this.crsSel = ((SimVar.GetSimVarValue("GPS OBS VALUE", "Degrees") || 0) + 360) % 360;
                    this.crsLock = false;
                    this.courseToDraw = this.crsSel;
                    this.WPdirect = false; // OBS is its own mode; direct-to flag not needed here

                } else {
                    // Not in OBS: DTK drives CDI; CRS box is read-only DTK
                    this.crsSel = dtkDeg;
                    this.crsLock = true;
                    this.courseToDraw = dtkDeg;

                    // Detect Direct-To (typed course) vs planned leg:
                    // TO waypoint is activeWaypointIndex, FROM is TO-1
                    const toIdx = (typeof this.activeWaypointIndex === "number") ? this.activeWaypointIndex : -1;
                    const fromIdx = (toIdx > 0) ? toIdx - 1 : -1;

                    if (toIdx < 0) {
                        // No previous waypoint: pure Direct-To
                        this.WPdirect = true;
                    } else if (fromIdx >= 0 &&
                        this.flightPlanWaypoints &&
                        this.flightPlanWaypoints[fromIdx] &&
                        this.flightPlanWaypoints[toIdx]) {
                        const prev = this.flightPlanWaypoints[fromIdx];
                        const next = this.flightPlanWaypoints[toIdx];
                        // Bearing of the planned leg (prev -> next)
                        const legBearingDeg = this.initialBearingDeg(prev.lat, prev.lon, next.lat, next.lon);
                        const diff = Math.abs(((dtkDeg - legBearingDeg + 540) % 360) - 180); // shortest angular diff
                        this.WPdirect = diff > 5; // threshold in degrees
                    } else {
                        this.WPdirect = false;
                    }
                }

                // UI/labels
                this.navSourceText = "GPS";
                this.identColor = "#e049b0";

                phaseIdx = Number(SimVar.GetSimVarValue("L:WTGarmin_LNavData_CDI_Scale_Label", "number"));
                this.phaseIdx = phaseIdx;
                this.phaseText = this.flightPhaseLabel(phaseIdx);

                let dist_m = Number(SimVar.GetSimVarValue("GPS WP DISTANCE", "meters")) || 0;
                if (dist_m < 0.05) dist_m = 0;
                this.distanceToNext = dist_m > 0 ? (dist_m / 1852).toFixed(1) : "";

                this.eteToNext = Number(SimVar.GetSimVarValue("GPS WP ETE", "seconds")) || "";
                if (this.eteToNext !== "" && !isNaN(this.eteToNext)) {
                    const eteInt = Math.floor(Number(this.eteToNext));
                    const eteMin = Math.floor(eteInt / 60);
                    const eteSec = eteInt % 60;
                    this.eteToNextStr = eteMin.toString().padStart(2, "0") + ":" + eteSec.toString().padStart(2, "0");
                } else {
                    this.eteToNextStr = "";
                }

            } else if (this.selectedNavSource === "VOR1") {

                this.navAvail = !!SimVar.GetSimVarValue("NAV SIGNAL:1", "Bool");
                this.toFromFlag = Number(SimVar.GetSimVarValue("NAV TOFROM:1", "Number")) || 0;
                this.gpsDrivesNav1 = false;
                this.crsLock = false;
                this.WPdirect = false;

                this.crsSel = ((SimVar.GetSimVarValue("NAV OBS:1", "Degrees") || 0) + 360) % 360;
                this.courseToDraw = this.crsSel;

                const locAvailable = !!SimVar.GetSimVarValue("NAV HAS LOCALIZER:1", "Bool");
                const gsAvailable = !!SimVar.GetSimVarValue("NAV HAS GLIDE SLOPE:1", "Bool");
                this.navSourceText = locAvailable && gsAvailable ? "ILS1"
                    : locAvailable && !gsAvailable ? "LOC1" : "VOR1";
                this.waypointIdent = SimVar.GetSimVarValue("NAV IDENT:1", "string") || "";
                this.identColor = "#00ff00";
                this.phaseText = gsAvailable ? "APR" : "ENR";
                this.distanceToNext = 0;//airplane does not have DME
                //airplane does not have DME
                this.distanceToNext = 0;
                this.eteToNext = "";
                this.eteToNextStr = "";

            } else if (this.selectedNavSource === "VOR2") {

                this.navAvail = !!SimVar.GetSimVarValue("NAV SIGNAL:2", "Bool");
                this.cdiNeedleValid = SimVar.GetSimVarValue("NAV HAS NAV:2", "Bool");
                this.toFromFlag = Number(SimVar.GetSimVarValue("NAV TOFROM:2", "Number")) || 0;
                this.cdiDeflection = SimVar.GetSimVarValue("NAV CDI:2", "Number") || 0;//use CDI instead of HSI CDI for NAV2 (autopilot will still follow HSI nav1)
                this.gpsDrivesNav1 = false;
                this.crsLock = false;
                this.WPdirect = false;

                this.crsSel = ((SimVar.GetSimVarValue("NAV OBS:2", "Degrees") || 0) + 360) % 360;
                this.courseToDraw = this.crsSel;

                const locAvailable = !!SimVar.GetSimVarValue("NAV HAS LOCALIZER:2", "Bool");
                const gsAvailable = !!SimVar.GetSimVarValue("NAV HAS GLIDE SLOPE:2", "Bool");
                this.navSourceText = locAvailable && gsAvailable ? "ILS2"
                    : locAvailable && !gsAvailable ? "LOC2" : "VOR2";
                this.waypointIdent = SimVar.GetSimVarValue("NAV IDENT:2", "string") || "";
                this.identColor = "#00ff00";
                this.phaseText = gsAvailable ? "APR" : "ENR";
                //airplane does not have DME
                this.distanceToNext = 0;
                this.eteToNext = "";
                this.eteToNextStr = "";
            }

            // Vertical guidance detection
            this.vtgType = "";
            this.vtgValid = false;
            this.vtgDeflection = 0;

            if ((this.selectedNavSource === "VOR1" || this.selectedNavSource === "VOR2") &&
                !!SimVar.GetSimVarValue("NAV HAS GLIDE SLOPE:1", "Bool")) {
                this.vtgType = "GS";
                this.vtgValid = true;
                this.vtgDeflection = Number(SimVar.GetSimVarValue("HSI GSI NEEDLE", "Number")) || 0;
            // GP when within 8NM of destination or already in GP(AP/FD) and not in VNAV unless AP/FD armed mode is not VNAV
            } else if (GPShasGP && (dest_dist < 8 || APactiveVertical === 5 || AParmedVertical < 7 ) && APactiveVertical !== 7) {
                this.vtgType = "GP";
                this.vtgValid = true;
                this.vtgDeflection = Number(SimVar.GetSimVarValue("HSI GSI NEEDLE", "Number")) || 0;
            } else if (this.selectedNavSource === "GPS" && SimVar.GetSimVarValue("L:WTAP_VNav_Path_Available", "number") === 1) {
                this.vtgType = "VNAV";
                this.vtgValid = true;
                const rawVnav = Number(SimVar.GetSimVarValue("L:WTAP_VNav_Vertical_Deviation", "number")) || 0;

                // Scale 250ft to the "127" gauge limit
                // This makes the needle hit the 2nd dot at 400ft off-path
                this.vtgDeflection = (rawVnav / 400) * 127;

                // Clamp to prevent the needle from flying off the gauge
                this.vtgDeflection = Math.max(-127, Math.min(127, this.vtgDeflection)) * -1;

                SimVar.SetSimVarValue("L:VNAV_deviation", "number", this.vtgDeflection);
            }

            // --- CDI/VDI Preview Logic ---
            this.isPreviewActive = false;      // Reset on each update cycle
            this.previewVtgValid = false;      // reset each cycle unless we prove it's valid
            this.previewVtgType = "";          // NEW: lets the display know if preview is GS vs GP, etc.
            this.previewVdiDeflection = 0;     // NEW: safe default

            // Only run preview logic if the feature is ON and GPS is the active source.
            if (this.cdiVdiPreviewOn && this.selectedNavSource === "GPS") {
                //const nav1Signal = !!SimVar.GetSimVarValue("NAV SIGNAL:1", "Bool");
                //const nav2Signal = !!SimVar.GetSimVarValue("NAV SIGNAL:2", "Bool");

                const nav1Avail = (Number(this.nav1Codes) !== 0);// && nav1Signal;
                const nav2Avail = (Number(this.nav2Codes) !== 0);// && nav2Signal;

                // Prefer GP preview first (for hollow diamond) if it's available.
                // You may want additional gating here (armed, approach active, within distance, etc).
                const gpPreviewAvailable = !!GPShasGP; // or (GPShasGP && (dest_dist < 8 || APactiveVertical === 6))

                // Determine preview source
                // "GP" or 1 or 2 or null
                let previewSource = null;

                if (gpPreviewAvailable) {
                    previewSource = "GP";
                } else if (nav1Avail) {
                    previewSource = 1;
                } else if (nav2Avail) {
                    previewSource = 2;
                }

                if (previewSource !== null) {
                    this.isPreviewActive = true;

                    // --- Preview CDI portion ---
                    // For GP preview, you probably still want to preview lateral from GPS (so leave your normal GPS CDI),
                    // OR keep existing NAV preview behavior. If you want GP preview only for VDI, keep CDI preview NAV-based.
                    // Below keeps your existing NAV-based CDI preview only when previewSource is 1/2.
                    if (previewSource === 1 || previewSource === 2) {
                        const navIndex = previewSource;
                        this.previewCdiDeflection = SimVar.GetSimVarValue(`NAV CDI:${navIndex}`, "Number") || 0;
                        this.previewToFrom = SimVar.GetSimVarValue(`NAV TOFROM:${navIndex}`, "Number") || 0;

                        // VDI preview from NAV glideslope
                        const hasGs = !!SimVar.GetSimVarValue(`NAV HAS GLIDE SLOPE:${navIndex}`, "Bool");
                        if (hasGs) {
                            this.previewVtgValid = true;
                            this.previewVtgType = "GS";
                            this.previewVdiDeflection = SimVar.GetSimVarValue(`NAV GSI:${navIndex}`, "Number") || 0;
                        } else {
                            this.previewVtgValid = false;
                            this.previewVtgType = "";
                            this.previewVdiDeflection = 0;
                        }
                    }

                    // --- Preview VDI portion for GP (hollow diamond) ---
                    if (previewSource === "GP") {
                        this.previewVtgValid = true;
                        this.previewVtgType = "GP";
                        this.previewCdiDeflection = Number(SimVar.GetSimVarValue("HSI CDI NEEDLE", "Number")) || 0;
                        // If your GP deviation already drives HSI GSI NEEDLE, you can reuse it.
                        // (This matches what you do in your main GP section.)
                        this.previewVdiDeflection = Number(SimVar.GetSimVarValue("HSI GSI NEEDLE", "Number")) || 0;

                        // If your VDI gauge expects the same scale/clamp as VNAV, do it here too (optional).
                        // this.previewVdiDeflection = Math.max(-127, Math.min(127, this.previewVdiDeflection));
                    }
                }
            }

            this.updateLocCdiPrompt();

            //mapview TAWS variables
            SimVar.SetSimVarValue("L:MFD_MapRange_NM", "Number", this.mapRange);
            this.visibleMapRange = this.mapRange * 2.2;
            const rangeInMeters = this.visibleMapRange * 1852;
            SimVar.SetSimVarValue("L:MAPVIEW_ZOOM_M", "Number", rangeInMeters);
            SimVar.SetSimVarValue("L:MAPVIEW_TRACK_DEG", "Number", this.trueHeading);

            // Map selectedNavSource to a number code
            let navSourceCode =
                this.selectedNavSource === "GPS" ? 0 :
                    this.selectedNavSource === "VOR1" ? 1 : 2;

            // L:vars for PFD to consume
            //SimVar.SetSimVarValue("L:NavSource", "number", navSourceCode);
            SimVar.SetSimVarValue("L:CDI_Deflection", "number", Math.round(this.cdiDeflection));
            SimVar.SetSimVarValue("L:VDI_Deflection", "number", Math.round(this.vtgDeflection));
            SimVar.SetSimVarValue("L:Phase", "number", phaseIdx || -1);
            SimVar.SetSimVarValue("L:VTG_Type", "number", this.getVTGtype(this.vtgType));
            SimVar.SetSimVarValue("L:VTG_Valid", "number", this.vtgValid ? 1 : 0);


            

            // --- TEST MODE (sliders/controls from browser window) ---
        } else {
            // Test mode
            this.airplaneLat = window.testAirplanePositionX || 30; // Update airplane latitude
            this.airplaneLon = window.testAirplanePositionY || -90; // Update airplane longitude
            this.trackMag = window.testHeading || 0;

            this.previousWaypointLat = 25;
            this.previousWaypointLon = -88;
            this.nextWaypointLat = 35;
            this.nextWaypointLon = -88;

            this.tasMph = 115;
            this.heading = window.testHeading || 0;
            if (this.RMI1Source === 1) {
                this.bearing1 = window.testBearing1 || NaN;
            } else if (this.RMI1Source === 2) {
                this.bearing1 = ((this.heading + (window.testBearing1 || 0) + 360) % 360);
            } else {
                this.bearing1 = NaN;
            }
            if (this.RMI2Source === 1) {
                this.bearing2 = window.testBearing2 || NaN;
            } else if (this.RMI2Source === 2) {
                this.bearing2 = ((this.heading + (window.testBearing2 || 0) + 360) % 360);
            } else {
                this.bearing2 = NaN;
            }
            this.trkSel = window.testTrack || 0;
            this.crsSel = window.testCrs || 0;
            this.gpsObsActive = !!window.testGpsObs;
            this.hsiBearing = window.testHsiBearing || 0;
            this.cdiDeflection = window.testCdiDeflection || 0;
            this.toFromFlag = (window.testToFromFlag !== undefined ? window.testToFromFlag : 1);

            // Vertical guidance (test mode: copy, extend, or override as needed)
            // USE or DEFAULT vtgType/vtgValid/vtgDeflection
            this.vtgType = (window.testVtgType !== undefined) ? window.testVtgType : "GP";
            this.vtgValid = (window.testVtgValid !== undefined) ? !!window.testVtgValid : true;
            this.vtgDeflection = (window.testVtgDeflection !== undefined) ? window.testVtgDeflection : 0;
            this.selectedNavSource = "GPS";

            // box/phase logic for test mode (unchanged)
            if (this.selectedNavSource === "GPS") {
                this.gpsDrivesNav1 = true;
                this.crsSel = window.testCrs1 || 0;
                this.crsLock = !this.gpsObsActive;
                this.courseToDraw = this.gpsObsActive ? this.crsSel : this.hsiBearing;
                this.waypointIdent = window.testIdent || "RW31";
                this.identColor = "#e049b0";
                this.phaseText = window.testPhaseText || "ENR";
                this.navSourceText = "GPS";
                this.distanceToNext = window.testDistanceToNext || "14.7";
                this.eteToNext = window.testEteToNext || 365;
                if (this.eteToNext !== "" && !isNaN(this.eteToNext)) {
                    let eteInt = parseInt(this.eteToNext, 10);
                    let eteMin = Math.floor(eteInt / 60);
                    let eteSec = eteInt % 60;
                    this.eteToNextStr = eteMin.toString().padStart(2, "0") + ":" + eteSec.toString().padStart(2, "0");
                } else {
                    this.eteToNextStr = "";
                }
            } else {
                this.gpsDrivesNav1 = false;
                this.crsLock = false;
                this.crsSel = window.testCrs1 || 0;
                this.courseToDraw = this.crsSel;
                this.waypointIdent = window.testIdent || "ILAX";
                this.identColor = "#00ff00";
                let chSuffix = (this.selectedNavSource === "VOR2") ? "2" : "1";
                let navRaw = window.testNavSourceText || "ILS";
                this.navSourceText = navRaw + chSuffix;
                this.phaseText = window.testPhaseText || "APR";
                this.distanceToNext = window.testDistanceToNext || "14.7";
                this.eteToNext = window.testEteToNext || 365;
                if (this.eteToNext !== "" && !isNaN(this.eteToNext)) {
                    let eteInt = parseInt(this.eteToNext, 10);
                    let eteMin = Math.floor(eteInt / 60);
                    let eteSec = eteInt % 60;
                    this.eteToNextStr = eteMin.toString().padStart(2, "0") + ":" + eteSec.toString().padStart(2, "0");
                } else {
                    this.eteToNextStr = "";
                }
            }
        }

        this.updateNearestAirports();
        this.updateOptionsAutoClose();
    }

    updateSmoothedWind() {
        if (typeof SimVar === "undefined") return;

        const now = Date.now();

        // Limit sample rate
        if (now - this._lastWindSampleMs < this.windSampleIntervalMs) {
            return;
        }
        this._lastWindSampleMs = now;

        const dir = Number(SimVar.GetSimVarValue("AMBIENT WIND DIRECTION", "degrees")) || 0;
        const spd = Number(SimVar.GetSimVarValue("AMBIENT WIND VELOCITY", "knots")) || 0;

        // Add new sample
        this.windSamples.push({ t: now, dir, spd });

        // Remove old samples outside averaging window
        const cutoff = now - this.windAverageWindowMs;
        while (this.windSamples.length > 0 && this.windSamples[0].t < cutoff) {
            this.windSamples.shift();
        }

        if (this.windSamples.length === 0) return;

        // Average speed
        let spdSum = 0;

        // Circular average for direction
        let x = 0;
        let y = 0;

        for (const s of this.windSamples) {
            spdSum += s.spd;

            const rad = s.dir * Math.PI / 180;
            x += Math.cos(rad);
            y += Math.sin(rad);
        }

        this.windDisplaySpeed = spdSum / this.windSamples.length;

        if (Math.abs(x) > 0.0001 || Math.abs(y) > 0.0001) {
            let avgDir = Math.atan2(y, x) * 180 / Math.PI;
            if (avgDir < 0) avgDir += 360;
            this.windDisplayDirection = avgDir;
        }
    }

    adjustMfdDimming(delta) {
        const step = 0.05;
        this.MFD_dimming = Math.max(-0.3, Math.min(0.5, this.MFD_dimming + delta * step));

        if (typeof SimVar !== "undefined") {
            SimVar.SetSimVarValue("L:MFD_Dim.1", "Number", this.MFD_dimming);
        }

        this.Update && this.Update();
    }

    startInitScreen() {
        this.initScreenActive = true;
        this.initScreenStartMs = Date.now();
    }

    updateInitScreenState() {
        if (!this.initScreenActive) return;

        const elapsed = Date.now() - this.initScreenStartMs;
        if (elapsed >= this.initScreenDurationMs) {
            this.initScreenActive = false;
        }
    }

    drawInitScreen(ctx) {
        if (!this.initScreenActive) return;

        const elapsed = Date.now() - this.initScreenStartMs;
        const remaining = Math.max(0, Math.ceil((this.initScreenDurationMs - elapsed) / 1000));

        ctx.save();
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 20px Arial";
        ctx.fillText("INITIALIZING", this.canvas.width / 2, this.canvas.height / 2 - 10);

        ctx.fillStyle = "#26c6ff";
        ctx.font = "bold 16px Arial";
        ctx.fillText(`${remaining}s`, this.canvas.width / 2, this.canvas.height / 2 + 22);

        this.currentPage = "primary";

        ctx.restore();
    }

    updatePowerState() {
        if (typeof SimVar === "undefined" || typeof SimVar.GetSimVarValue !== "function") {
            this.avionicsON = true;
            this.pfdPowered = true;
            this.mfdPowered = true;
            return;
        }

        const batteryOn = SimVar.GetSimVarValue("ELECTRICAL MASTER BATTERY:1", "Bool") === 1;
        // Check the actual voltage on the main bus (bus.1)
        const mainBusVoltage = SimVar.GetSimVarValue("ELECTRICAL MAIN BUS VOLTAGE:1", "Volts");

        // Keep these if other parts of the MFD still use them
        this.avionicsON = SimVar.GetSimVarValue("CIRCUIT AVIONICS ON", "Boolean") === 1;
        this.pfdPowered = SimVar.GetSimVarValue("L:PFD_powered", "Number") === 1;

        // force ADI page if PFD loses power
        if (!this.pfdPowered && this.currentPage !== "adi") {
            this.currentPage = "adi";
        }

        // Real MFD bus power for this aircraft
        const mfdBreakerOn = SimVar.GetSimVarValue("L:CB_MFD", "Bool") === 1;
        this.mfdPowered = (batteryOn || mainBusVoltage > 0) && mfdBreakerOn;

        // If aircraft power comes back, clear the internal-battery override
        if (this.mfdPowered && this.stayOnOverride) {
            this.stayOnOverride = false;
        }

        // MFD remains alive if powered normally OR pilot chose to keep it on
        const mfdPoweredNow = this.mfdPowered || this.stayOnOverride;

        // First load: establish baseline only
        if (this.mfdPoweredLast === null) {
            this.mfdPoweredLast = mfdPoweredNow;
            this.hasBeenPowered = this.mfdPowered;

            if (!mfdPoweredNow) {
                this.initScreenActive = false;
                this.shutdownActive = false;
                this.shutdownComplete = false;
                this.shutdownRemainingMs = 0;
            }
            return;
        }

        // Rising edge: aircraft electrical power came ON
        if (!this.mfdPoweredLast && this.mfdPowered) {
            this.hasBeenPowered = true;
            this.startInitScreen();
            this.shutdownActive = false;
            this.shutdownComplete = false;
            this.shutdownRemainingMs = 0;
            this.stayOnOverride = false;
        }

        // Falling edge: aircraft electrical power went OFF
        if (this.mfdPoweredLast && !this.mfdPowered && !this.stayOnOverride) {
            if (this.hasBeenPowered) {
                this.shutdownActive = true;
                this.shutdownComplete = false;
                this.shutdownStartMs = Date.now();
                this.shutdownRemainingMs = this.shutdownDelayMs;
                this.preShutdownPage = this.currentPage;
            }

            this.initScreenActive = false;
        }

        // Shutdown countdown
        if (this.shutdownActive && !this.shutdownComplete) {
            const elapsed = Date.now() - this.shutdownStartMs;
            this.shutdownRemainingMs = Math.max(0, this.shutdownDelayMs - elapsed);
            this.currentPage = "adi";

            if (this.shutdownRemainingMs <= 0) {
                this.shutdownActive = false;
                this.shutdownComplete = true;
            }
        }

        // If aircraft electrical power comes back, cancel shutdown state
        if (this.mfdPowered) {
            this.shutdownActive = false;
            this.shutdownComplete = false;
            this.shutdownRemainingMs = 0;
        }

        this.mfdPoweredLast = mfdPoweredNow;
        this.updateInitScreenState();
    }

    forceShutdownNow() {
        this.shutdownActive = false;
        this.shutdownComplete = true;
        this.shutdownRemainingMs = 0;
        this.currentPage = "adi";
    }

    drawShutdownOverlay(ctx) {
        if (!this.shutdownActive) return;

        const seconds = Math.ceil(this.shutdownRemainingMs / 1000);

        // Dark overlay
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Main dialog box
        const boxX = 55;
        const boxY = 95;
        const boxW = 210;
        const boxH = 145;

        ctx.fillStyle = "#000";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.font = "bold 16px Arial";
        ctx.fillStyle = "#ffffff";
        ctx.fillText("MFD SHUTDOWN", boxX + boxW / 2, boxY + 22);

        ctx.font = "bold 24px Arial";
        ctx.fillStyle = "#26c6ff";
        ctx.fillText(`${seconds}s`, boxX + boxW / 2, boxY + 52);

        // Shutdown now button
        const btn = this.touchBoxes.find(b => b.id === "shutdown_now");
        if (btn) {
            ctx.fillStyle = "#111";
            ctx.strokeStyle = "#26c6ff";
            ctx.lineWidth = 2;
            ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
            ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);

            ctx.font = "bold 13px Arial";
            ctx.fillStyle = "#ffffff";
            ctx.fillText("SHUTDOWN NOW", btn.x + btn.w / 2, btn.y + btn.h / 2 + 1);
        }

        const stayBtn = this.touchBoxes.find(b => b.id === "stay_on");
        if (stayBtn) {
            ctx.fillStyle = "#111";
            ctx.strokeStyle = "#26c6ff";
            ctx.lineWidth = 2;
            ctx.fillRect(stayBtn.x, stayBtn.y, stayBtn.w, stayBtn.h);
            ctx.strokeRect(stayBtn.x, stayBtn.y, stayBtn.w, stayBtn.h);

            ctx.font = "bold 13px Arial";
            ctx.fillStyle = "#ffffff";
            ctx.fillText("STAY ON", stayBtn.x + stayBtn.w / 2, stayBtn.y + stayBtn.h / 2 + 1);
        }

        ctx.restore();
    }

    distanceNmApprox(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
        const toRad = Math.PI / 180;
        const meanLat = ((lat1Deg + lat2Deg) / 2) * toRad;

        // 1 deg lat ≈ 60 NM, 1 deg lon ≈ 60*cos(lat) NM
        const nmPerDegLat = 60;
        const nmPerDegLon = 60 * Math.cos(meanLat);

        const dLat = (lat2Deg - lat1Deg);
        const dLon = (lon2Deg - lon1Deg);

        const dx = dLon * nmPerDegLon;
        const dy = dLat * nmPerDegLat;

        return Math.sqrt(dx * dx + dy * dy);
    }

    getAirportIconFor(apt) {
        if (!this.airportIcons) return null;

        const kind = Number(apt && apt.kind) || 0;

        // NOTE: "kind" values vary by sim/gauge. Keep your mapping flexible.
        // You said Helipad + Private exist; we prioritize those if detected.
        //if (kind === 4) return this.airportIcons.helipad;  // helipad (example)
        if (kind === 5) return this.airportIcons.private;  // private/restricted (example)

        // Default: towered vs non-towered
        return (apt && apt.towered) ? this.airportIcons.tower : this.airportIcons.nontower;
    }

    // Call this once per Update() (or from getSimVars), like you do now.
    updateNearestAirports() {
        if (typeof SimVar === "undefined" || typeof SimVar.GetSimVarValue !== "function") return;

        const rangeNm = Math.max(0, Number(this.visibleMapRange) || 0);
        if (rangeNm <= 0) {
            this.nearestAirportMap = {};
            this.nearestAirports = [];
            this.nearestIndex = 0;
            return;
        }

        if (!this.nearestAirportMap) this.nearestAirportMap = {};

        // Configure search
        SimVar.SetSimVarValue("C:fs9gps:NearestAirportMaximumItems", "number", this.nearestAirportMaxItems);

        // Important: ask the sim for a bit MORE than you display so entries don't thrash at the edge
        const searchNm = Math.max(rangeNm * 1.5, rangeNm + 5); // tune as desired
        SimVar.SetSimVarValue("C:fs9gps:NearestAirportMaximumDistance", "meters", searchNm * 1852);

        // Set search center (radians)
        const latRad = SimVar.GetSimVarValue("PLANE LATITUDE", "radians");
        const lonRad = SimVar.GetSimVarValue("PLANE LONGITUDE", "radians");
        SimVar.SetSimVarValue("C:fs9gps:NearestAirportCurrentLatitude", "radians", latRad);
        SimVar.SetSimVarValue("C:fs9gps:NearestAirportCurrentLongitude", "radians", lonRad);

        const items = Number(SimVar.GetSimVarValue("C:fs9gps:NearestAirportItemsNumber", "number")) || 0;
        SimVar.SetSimVarValue("L:NearestAirportItems", "number", items);

        if (items <= 0) {
            // Don't instantly clear; but since you asked "only remove if distance > range",
            // we keep what we have and just let pruning handle it below.
        } else {
            const n = Math.min(items, this.nearestAirportMaxItems);
            const line = (this.nearestIndex % n);

            // NOTE: try 0-based first; if you suspect 1-based, change to (line + 1).
            SimVar.SetSimVarValue("C:fs9gps:NearestAirportCurrentLine", "number", line);

            const icao = SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentICAO", "string") || "";
            const ident = SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentIdent", "string") || "";

            if (icao || ident) {
                let aptLat = Number(SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentAirportLatitude", "degrees"));
                let aptLon = Number(SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentAirportLongitude", "degrees"));

                // If radians slip through, convert
                if (Math.abs(aptLat) <= 3.2 && Math.abs(aptLon) <= 3.2) {
                    aptLat = aptLat * 180 / Math.PI;
                    aptLon = aptLon * 180 / Math.PI;
                }

                const distM = Number(SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentDistance", "meters")) || 0;
                const distNm = distM / 1852;

                const kind = Number(SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentAirportKind", "number")) || 0;

                let towered = false;
                try { towered = !!SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentTowered", "bool"); } catch (e) { }

                // Key: prefer ICAO; fall back to ident; last resort: lat/lon string (rare)
                const key = (icao || ident || `${aptLat.toFixed(4)},${aptLon.toFixed(4)}`).toUpperCase();

                // UPSERT: overwrite/refresh the entry
                this.nearestAirportMap[key] = {
                    key,
                    icao,
                    ident,
                    lat: aptLat,
                    lon: aptLon,
                    distanceNm: distNm,
                    kind,
                    towered,
                    _lastSeen: Date.now()
                };
            }

            this.nearestIndex++;
        }

        // PRUNE: ONLY remove if distance > range (with tiny hysteresis to prevent edge popping)
        const pruneLimitNm = rangeNm * 1.03; // 3% hysteresis
        for (const key in this.nearestAirportMap) {
            const a = this.nearestAirportMap[key];
            if (!a || !isFinite(a.distanceNm)) continue;

            if (a.distanceNm > pruneLimitNm) {
                delete this.nearestAirportMap[key];
            }
        }

        // Rebuild the array used for drawing (stable sort)
        const arr = Object.values(this.nearestAirportMap);

        // Keep only the closest N you want to draw (optional, but usually desired)
        arr.sort((a, b) => (a.distanceNm || 0) - (b.distanceNm || 0));
        this.nearestAirports = arr.slice(0, this.nearestAirportMaxItems);

        if (this.nearestAirports && this.nearestAirports.length > 0) {
            let closestDist = this.nearestAirports[0].distanceNm;
            if (isFinite(closestDist)) {
                SimVar.SetSimVarValue("L:NEAREST_APT_DIST", "Number", closestDist);
            }
        } else {
            // If no airports are found in range, set to a high number so TAWS stays active
            SimVar.SetSimVarValue("L:NEAREST_APT_DIST", "Number", 9999);
        }
    }

    drawNearestAirports(ctx, cx, cy, R) {
        R = R * this.mapScaleTweak; // tweak scale

        let track;
        if (this.HdgTrk === 0) {
            track = this.trueHeading;
        } else {
            track = this.trackTrue;
        }

        const list = (this.nearestAirports || []).filter(Boolean);
        if (!Array.isArray(list) || list.length === 0) return;

        const centerLat = Number(this.airplaneLat);
        const centerLon = Number(this.airplaneLon);
        if (!isFinite(centerLat) || !isFinite(centerLon)) return;

        const mapRotRad = (-track * Math.PI) / 180;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(mapRotRad);

        for (let i = 0; i < list.length; i++) {
            const apt = list[i];
            if (!apt || !isFinite(apt.lat) || !isFinite(apt.lon)) continue;

            if (isFinite(apt.distanceNm) && apt.distanceNm > (Number(this.visibleMapRange) || 0) * 1.01) continue;

            const p = this.LatLongToXY(apt.lat, apt.lon, R, this.visibleMapRange, centerLat, centerLon);
            if (!p) continue;

            if ((p.x * p.x + p.y * p.y) > (R * 1.15) * (R * 1.15)) continue;

            const img = this.getAirportIconFor(apt);
            if (!img || !img.complete || img.naturalWidth <= 0) continue;

            const size = 16;

            // Draw the icon upright
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(-mapRotRad);
            ctx.drawImage(img, -size / 2, -size / 2, size, size);

            // Draw airport label in white
            const label = (apt.ident && String(apt.ident).trim()) || (apt.icao && String(apt.icao).trim()) || "";
            if (label) {
                const offsetX = 10;
                const offsetY = -10;

                ctx.font = "10px Arial";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.globalAlpha = 1.0;
                ctx.fillStyle = "#fff";
                ctx.fillText(label, offsetX, offsetY);
            }

            ctx.restore();
        }

        ctx.restore();
    }

    /*getNearestAirports() {
        SimVar.SetSimVarValue("C:fs9gps:NearestAirportMaximumItems", "number", 10);
        SimVar.SetSimVarValue("C:fs9gps:NearestAirportMaximumDistance", "meters", 50000);

        var lat = SimVar.GetSimVarValue("PLANE LATITUDE", "radians");
        var lon = SimVar.GetSimVarValue("PLANE LONGITUDE", "radians");
        SimVar.SetSimVarValue("C:fs9gps:NearestAirportCurrentLatitude", "radians", lat);
        SimVar.SetSimVarValue("C:fs9gps:NearestAirportCurrentLongitude", "radians", lon);

        var items = SimVar.GetSimVarValue("C:fs9gps:NearestAirportItemsNumber", "number");
        SimVar.SetSimVarValue("L:NearestAirportItems", "number", items);

        if (items <= 0) return;

        // first item
        SimVar.SetSimVarValue("C:fs9gps:NearestAirportCurrentLine", "number", 1);

        var icao = SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentICAO", "string");


        this.debugText = icao;


        var ident = SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentIdent", "string");
        var distM = SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentDistance", "meters");
        var brgTrue = SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentTrueBearing", "degrees");
        var kind = SimVar.GetSimVarValue("C:fs9gps:NearestAirportCurrentAirportKind", "number");

        // Numbers are fine in LVars:
        SimVar.SetSimVarValue("L:Nearest0_DistM", "number", distM);
        SimVar.SetSimVarValue("L:Nearest0_BrgTrue", "number", brgTrue);
        SimVar.SetSimVarValue("L:Nearest0_Kind", "number", kind);

        // Strings: only do this if your gauge/instrument supports string LVars
        // (some setups don't). If it works for you, keep it:
        SimVar.SetSimVarValue("L:Nearest0_ICAO", "string", icao);
        SimVar.SetSimVarValue("L:Nearest0_Ident", "string", ident);
    }*/

    normalizeNavFreqToMHz(freq) {
        const f = Number(freq);
        if (!isFinite(f)) return NaN;

        // If it looks like Hz (e.g. 109900000), convert to MHz
        if (f > 1000) return f / 1e6;

        // Already MHz (e.g. 109.90)
        return f;
    }

    isIlsLocFreq(freq) {
        const mhz = this.normalizeNavFreqToMHz(freq);
        if (!isFinite(mhz)) return false;
        return mhz >= 108.10 && mhz <= 111.95;
    }

    isEditableOption(label) {
        return ["CRS", "TRK", "Bearing 1", "Bearing 2"].includes(label);
    }

    rmiSourceText(src, which) {
        // which: 1 or 2
        switch (Number(src)) {
            case 0: return "OFF";
            case 1: return "GPS";
            case 2: return `NAV${which}`;   // or "VOR1"/"VOR2" if you prefer
            default: return "---";
        }
    }

    cycleRmiSource(which, delta) {
        // delta: +1 or -1
        const wrap = (v, max) => ((v % (max + 1)) + (max + 1)) % (max + 1); // wrap 0..max

        if (which === 1) {
            this.RMI1Source = wrap(this.RMI1Source + Math.sign(delta), 2); // 0..2
            if (typeof SimVar !== "undefined") {
                SimVar.SetSimVarValue("L:RMI_SRC.1", "number", this.RMI1Source);
            }
        } else if (which === 2) {
            this.RMI2Source = wrap(this.RMI2Source + Math.sign(delta), 2);
            if (typeof SimVar !== "undefined") {
                SimVar.SetSimVarValue("L:RMI_SRC.2", "number", this.RMI2Source);
            }
        }
    }

    getOptionLabelLines(label) {
        if (label === "CRS") {
            const crs = Math.round(this.crsSel);
            return ["CRS", String(crs).padStart(3, "0")];
        }

        if (label === "TRK") {
            const trk = (Math.round(this.trkSel) % 360 + 360) % 360;
            return ["TRK", String(trk === 0 ? 360 : trk).padStart(3, "0")];
        }

        if (label === "Bearing 1") {
            const sourceText = this.rmiSourceText(this.RMI1Source, 1);
            const color = sourceText === "GPS" ? this.magenta : "#00ff00";
            return ["Bearing 1", sourceText, color]; // Return ["Line 1", "Line 2", "Color"]
        }

        if (label === "Bearing 2") {
            const sourceText = this.rmiSourceText(this.RMI2Source, 2);
            const color = sourceText === "GPS" ? this.magenta : "#00ff00";
            return ["Bearing 2", sourceText, color];
        }

        if (label === "LOC CDI Prompt") {
            return ["LOC CDI", "Prompt"];
        }

        const parts = (label || "").split(" ");
        if (parts.length > 1) return [parts[0], parts.slice(1).join(" ")];
        return [label];
    }

    getVTGtype(txt) {
        switch (txt) {
            case "GS": return 0;
            case "GP": return 1;
            case "VNAV": return 2;
            default: return -1;
        }
    }

    findFafWaypoint(approachList) {
        if (!Array.isArray(approachList) || approachList.length < 2) return null;

        const isRunwayIdent = (ident) => /^RW\d{2}[LRC]?$/i.test(String(ident || "").trim());

        let rwIndex = -1;
        for (let i = approachList.length - 1; i >= 0; i--) {
            if (isRunwayIdent(approachList[i].name)) {
                rwIndex = i;
                break;
            }
        }
        if (rwIndex < 0) rwIndex = approachList.length - 1;

        // FAF = fix before runway, skipping USER points
        for (let i = rwIndex - 1; i >= 0; i--) {
            const wp = approachList[i];
            if (!wp) continue;
            if (!Number.isFinite(wp.lat) || !Number.isFinite(wp.lon)) continue;

            const name = String(wp.name || "").toUpperCase().trim();
            if (!name || name === "USER") continue;

            return {
                name: wp.name,
                lat: wp.lat,
                lon: wp.lon,
                index: i
            };
        }

        return null;
    }

    // Add this helper near your other helpers
    syncActiveWaypointFromSim() {
        // Try by ident first
        var nextId = this.waypointIdent;

        if (nextId && this.flightPlanWaypoints && this.flightPlanWaypoints.length) {
            var idx = -1;
            var needle = nextId.toUpperCase();
            for (var i = 0; i < this.flightPlanWaypoints.length; i++) {
                var name = (this.flightPlanWaypoints[i].name || "").toUpperCase();
                if (name === needle) {
                    this.activeWaypointIndex = i;
                    this.waypointLat = this.flightPlanWaypoints[i].lat;
                    this.waypointLon = this.flightPlanWaypoints[i].lon;

                    SimVar.SetSimVarValue("L:MFD_activeWaypointSet", "number", this.activeWaypointIndex);

                    break;
                }
            }
            if (idx >= 0) {
                this.activeWaypointIndex = this.activeWaypointIndex;//next wp id not found in fp, so use coherent call active wp index
                return;
            }
        }

        // Fallback: match by lat/lon (tolerance)
        /*var nextLat = (typeof SimVar !== "undefined") ? SimVar.GetSimVarValue("GPS WP NEXT LAT", "degrees") : NaN;
        var nextLon = (typeof SimVar !== "undefined") ? SimVar.GetSimVarValue("GPS WP NEXT LON", "degrees") : NaN;

        if (isFinite(nextLat) && isFinite(nextLon) && this.flightPlanWaypoints && this.flightPlanWaypoints.length) {
            var bestIndex = -1, bestScore = Infinity;
            for (var j = 0; j < this.flightPlanWaypoints.length; j++) {
                var wp = this.flightPlanWaypoints[j];
                if (!isFinite(wp.lat) || !isFinite(wp.lon)) continue;
                var dLat = wp.lat - nextLat;
                var dLon = wp.lon - nextLon;
                var score = Math.abs(dLat) + Math.abs(dLon); // simple metric
                if (score < bestScore) { bestScore = score; bestIndex = j; }
            }
            if (bestIndex >= 0) {
                this.activeWaypointIndex = bestIndex;
                
            }
        }*/

        SimVar.SetSimVarValue("L:MFD_activeWaypoint", "number", this.activeWaypointIndex);

    }

    // Function to calculate new Lat/Lon
    calculateWaypoint(currLat, currLon, bearingDeg, distanceNM) {
        const R = 3440.065; // Earth radius in Nautical Miles
        const dRad = distanceNM / R;
        const brngRad = bearingDeg * (Math.PI / 180);
        const lat1Rad = currLat * (Math.PI / 180);
        const lon1Rad = currLon * (Math.PI / 180);

        const lat2Rad = Math.asin(
            Math.sin(lat1Rad) * Math.cos(dRad) +
            Math.cos(lat1Rad) * Math.sin(dRad) * Math.cos(brngRad)
        );

        const lon2Rad = lon1Rad + Math.atan2(
            Math.sin(brngRad) * Math.sin(dRad) * Math.cos(lat1Rad),
            Math.cos(dRad) - Math.sin(lat1Rad) * Math.sin(lat2Rad)
        );

        return {
            lat: lat2Rad * (180 / Math.PI),
            lon: ((lon2Rad * (180 / Math.PI) + 540) % 360) - 180 // Normalize longitude
        };
    }

    // Disable LOC CDI prompt on RNAV approach types.
    // Using the WTGarmin phase label index you already read.
    isRnavApproachPhaseIdx(idx) {
        switch (Number(idx)) {
            case 1:  // TERM (unspecified terminal, often GPS)
            case 6:  // LNAV
            case 7:  // LNAV+V
            case 9:  // LNAV/V
            case 10: // LP
            case 11: // LP+V
            case 12: // LPV
                return true;
            default:
                return false;
        }
    }

    isLocIlsApproachActive() {
        if (typeof SimVar === "undefined" || typeof SimVar.GetSimVarValue !== "function") {
            return false;
        }

        // Must be in approach mode (your original intent)
        const apprMode = Number(SimVar.GetSimVarValue("GPS APPROACH MODE", "Number")) || 0;
        if (apprMode === 0) return false;

        if (Number(this.phaseIdx) === 14) return false; // MAPR

        // If the current approach is an RNAV-type (LNAV/V, LP, LP+V, LPV), do NOT show LOC CDI prompt.
        // This fixes “prompt shows on RNAV/GPS approaches”.
        if (this.isRnavApproachPhaseIdx(this.phaseIdx)) return false;

        // Need geometry to know “near FAF / inbound”
        if (!this.fafWaypoint) return false;
        if (!Number.isFinite(this.finalApproachCourseDeg)) return false;

        // IMPORTANT: do NOT require a valid tuned localizer/glideslope signal here.
        // You wanted it to flash even if not tuned / no valid signal.
        return true;
    }

    isIlsLocApproachLoaded() {
        if (typeof SimVar === "undefined" || typeof SimVar.GetSimVarValue !== "function") return false;

        // Use ACTIVE freq (not standby) because the goal is “switch to green needles now”.
        const nav1Active = Number(SimVar.GetSimVarValue("NAV ACTIVE FREQUENCY:1", "MHz"));
        return this.isIlsLocFreq(nav1Active);
    }

    updateLocCdiPrompt() {
        if (!this.locCdiPromptOn || this.phaseText === "MAPR") {//prompt not on or on missed approach
            this.locCdiPromptActive = false;
            this.locCdiPromptFlash = false;
            this.distanceToFafNm = null;
            this.inboundToFaf = false;
            return;
        }

        // Prompt only matters while still in GPS
        if (this.selectedNavSource !== "GPS") {
            this.locCdiPromptActive = false;
            this.locCdiPromptFlash = false;
            this.distanceToFafNm = null;
            this.inboundToFaf = false;
            return;
        }

        if (!this.isLocIlsApproachActive() || !this.fafWaypoint) {
            this.locCdiPromptActive = false;
            this.locCdiPromptFlash = false;
            this.distanceToFafNm = null;
            this.inboundToFaf = false;
            return;
        }

        const distNm = this.distanceNmApprox(
            this.airplaneLat,
            this.airplaneLon,
            this.fafWaypoint.lat,
            this.fafWaypoint.lon
        );

        this.distanceToFafNm = distNm;

        // Arm prompt within 5 NM of FAF and inbound
        this.inboundToFaf = this.isInboundForLocPrompt();

        this.locCdiPromptActive =
            isFinite(distNm) &&
            distNm <= 5 &&
            this.inboundToFaf;

        if (!this.locCdiPromptActive) {
            this.locCdiPromptFlash = false;
            return;
        }

        const now = Date.now();
        if (!this.locCdiPromptLastBlinkMs) {
            this.locCdiPromptLastBlinkMs = now;
            this.locCdiPromptFlash = true;
        } else if ((now - this.locCdiPromptLastBlinkMs) >= this.locCdiPromptBlinkPeriodMs) {
            this.locCdiPromptFlash = !this.locCdiPromptFlash;
            this.locCdiPromptLastBlinkMs = now;
        }
    }

    angleDiffDeg(a, b) {
        return Math.abs(((a - b + 540) % 360) - 180);
    }

    isInboundForLocPrompt() {
        if (!Number.isFinite(this.finalApproachCourseDeg)) return false;

        // Prefer ground track when moving, otherwise heading
        let currentCourse = Number(this.trackTrue);
        if (!isFinite(currentCourse)) currentCourse = Number(this.trueHeading);
        if (!isFinite(currentCourse)) currentCourse = Number(this.heading);
        if (!isFinite(currentCourse)) return false;

        const diff = this.angleDiffDeg(currentCourse, this.finalApproachCourseDeg);

        // Allow some intercept angle, but block obvious downwind/base/outbound cases
        return diff <= 90;
    }

    // Put this helper somewhere in the class (near your other helpers)
    removeDuplicateWaypoint(approachList) {
        if (!Array.isArray(approachList) || approachList.length < 2) return;

        const first = approachList[0];
        if (!first) return;

        const firstName = String(first.name || "").trim().toUpperCase();
        if (!firstName) return;

        // If the first waypoint's name is duplicated later in the list, remove the first one.
        // (This targets the common "transition fix duplicated" issue: WUNUB ... WUNUB ...)
        for (let i = 1; i < approachList.length; i++) {
            var wp = (approachList && approachList[i]) ? approachList[i] : null;
            var nm = (wp && wp.name != null) ? String(wp.name) : "";
            nm = nm.trim().toUpperCase();
            if (nm && nm === firstName) {
                approachList.shift();
                return;
            }
        }
    }

    sanitizeBaseFlightPlanWaypoints(list) {
        if (!Array.isArray(list) || list.length < 2) return list;

        const norm = (s) => String(s || "").trim().toUpperCase();

        const origin = list[0];
        const originIdent = norm(origin && origin.name);

        // Find destination as the last airport-like ident in the raw list
        let dest = null;
        let destIdent = "";
        for (let i = list.length - 1; i >= 0; i--) {
            const wp = list[i];
            const ident = norm(wp && wp.name);
            if (/^[A-Z0-9]{3,4}$/.test(ident) && ident !== originIdent) {
                dest = wp;
                destIdent = ident;
                break;
            }
        }

        if (!dest) return list;

        const middle = [];
        const seen = {};

        for (let i = 1; i < list.length; i++) {
            const wp = list[i];
            const ident = norm(wp && wp.name);
            if (!ident) continue;
            if (ident === destIdent) continue;
            if (!seen[ident]) {
                seen[ident] = true;
                middle.push(wp);
            }
        }

        return [origin, ...middle, dest];
    }

    // Flicker-free: fetch enroute + approach, then swap atomically
    async getWaypoints() {
        if (this._fpFetchInFlight) return;
        this._fpFetchInFlight = true;

        let newWaypoints = [];
        let newActiveIndex = this.activeWaypointIndex; // keep last known if missing
        let hadBasePlan = false;

        // Approach data (kept separate for Option A)
        let approachList = [];

        try {
            // --- Base flight plan ---
            const flightPlan = await Coherent.call("GET_FLIGHTPLAN");
            console.log("Flight Plan Received:", flightPlan);

            if (flightPlan && Array.isArray(flightPlan.waypoints)) {
                hadBasePlan = true;

                if (typeof flightPlan.activeWaypointIndex === "number" && flightPlan.activeWaypointIndex >= 0) {
                    newActiveIndex = flightPlan.activeWaypointIndex;
                }

                for (let i = 0; i < flightPlan.waypoints.length; i++) {
                    const wp = flightPlan.waypoints[i] || {};
                    const lla = wp.lla || {};
                    const lat = (typeof lla.lat === "number") ? lla.lat : 0;
                    const lon = (typeof lla.long === "number") ? lla.long : 0;
                    const name = wp.ident || ("WP" + (i + 1));
                    newWaypoints.push({ lat, lon, name });
                }

                // Keep any existing L:Vars you were setting
                if (typeof SimVar !== "undefined") {
                    this.activeWaypointIndex = flightPlan.activeWaypointIndex;
                    SimVar.SetSimVarValue("L:isDirectTo", "bool", flightPlan.isDirectTo);
                    SimVar.SetSimVarValue("L:isDirectToIntoFP", "bool", flightPlan.isDirectToIntoFP);
                }
            } else {
                console.error("Invalid or empty flight plan data:", flightPlan);
            }

            // After building newWaypoints from flightPlan.waypoints:
            const destinationIdent =
                flightPlan && flightPlan.waypoints && flightPlan.waypoints.length
                    ? String(flightPlan.waypoints[flightPlan.waypoints.length - 1].ident || "").trim().toUpperCase()
                    : "";

            newWaypoints = this.sanitizeBaseFlightPlanWaypoints(newWaypoints, destinationIdent, flightPlan);

            // --- Approach flight plan (kept separate; NOT merged into base plan) ---
            try {
                const appr = await Coherent.call("GET_APPROACH_FLIGHTPLAN");
                console.log("Approach Flight Plan Received:", appr);

                if (appr && Array.isArray(appr.waypoints) && appr.waypoints.length > 0) {
                    for (let j = 0; j < appr.waypoints.length; j++) {
                        const awp = appr.waypoints[j] || {};
                        const alla = awp.lla || {};
                        const alat = (typeof alla.lat === "number") ? alla.lat : 0;
                        const alon = (typeof alla.long === "number") ? alla.long : 0;
                        const aname = awp.ident || ("APPR" + (j + 1));
                        approachList.push({ lat: alat, lon: alon, name: aname });
                    }
                }

                // Final approach course for autoset (use approach list only)
                const facTrue = this.deriveFinalApproachCourseDeg(approachList);
                this.finalApproachCourseDeg = facTrue;

                if (facTrue !== null && typeof SimVar !== "undefined") {
                    const facMag = (facTrue - (this.magVar || 0) + 360) % 360;
                    SimVar.SetSimVarValue("L:MFD_ApproachFinalCourse_MAG", "number", facMag);
                    this.apprCourse = facMag;
                }

                // OPTION A: Only patch/insert the transition waypoint when the approach is ACTIVE
                // (Prevents odd geometry from appearing before approach mode)
                const apprMode = (typeof SimVar !== "undefined")
                    ? (Number(SimVar.GetSimVarValue("GPS APPROACH MODE", "Number")) || 0)
                    : 0;

                if (approachList.length > 0 && apprMode >= 1 && typeof SimVar !== "undefined") {
                    const wpname = SimVar.GetSimVarValue("GPS WP NEXT ID", "string") || "";

                    const aprExists = approachList.some(wp => wp.name === wpname);
                    const fpExists = newWaypoints.some(wp => wp.name === wpname);

                    SimVar.SetSimVarValue("L:MFD_APPR_exists", "bool", aprExists);
                    SimVar.SetSimVarValue("L:MFD_FP_exists", "bool", fpExists);

                    const calculatedWP = this.calculateWaypoint(
                        this.airplaneLat,
                        this.airplaneLon,
                        this.bearingToWP,
                        this.distanceToWP
                    );

                    approachList.unshift({
                        lat: calculatedWP.lat,
                        lon: calculatedWP.lon,
                        name: wpname
                    });

                    // NEW: remove the first waypoint only if it's duplicated later
                    this.removeDuplicateWaypoint(approachList);

                    SimVar.SetSimVarValue("L:MFD_APPR_TRANSITION_ADDED", "bool", true);
                }

            } catch (apErr) {
                console.warn("GET_APPROACH_FLIGHTPLAN failed or unavailable:", apErr);
            }

            // --- Compute FAF waypoint from approach only (needed for LOC prompt logic) ---
            this.approachWaypoints = approachList.slice();
            this.fafWaypoint = this.findFafWaypoint(this.approachWaypoints);

            // --- Atomic swap (NO MERGE) ---
            // Base plan stays base-only; approach stays approach-only.
            if (newWaypoints.length > 0 || hadBasePlan || approachList.length > 0) {
                this.flightPlanWaypoints = newWaypoints;
                this.activeWaypointIndex = newActiveIndex;

                if (typeof SimVar !== "undefined") {
                    // Publish base plan to L:Vars (optional; keep if you rely on it)
                    for (let k = 0; k < this.flightPlanWaypoints.length; k++) {
                        const wpk = this.flightPlanWaypoints[k];
                        SimVar.SetSimVarValue("L:MFD_FlightPlan_Waypoint_" + k + "_Lat", "degrees", wpk.lat);
                        SimVar.SetSimVarValue("L:MFD_FlightPlan_Waypoint_" + k + "_Lon", "degrees", wpk.lon);
                        SimVar.SetSimVarValue("L:MFD_FlightPlan_Waypoint_" + k + "_Name", "string", wpk.name);
                    }
                    SimVar.SetSimVarValue("L:MFD_FlightPlan_WaypointCount", "number", this.flightPlanWaypoints.length);

                    // Optional: publish approach separately (only if you want it)
                    SimVar.SetSimVarValue("L:MFD_Approach_WaypointCount", "number", this.approachWaypoints.length);
                    for (let a = 0; a < this.approachWaypoints.length; a++) {
                        const wpa = this.approachWaypoints[a];
                        SimVar.SetSimVarValue("L:MFD_Approach_Waypoint_" + a + "_Lat", "degrees", wpa.lat);
                        SimVar.SetSimVarValue("L:MFD_Approach_Waypoint_" + a + "_Lon", "degrees", wpa.lon);
                        SimVar.SetSimVarValue("L:MFD_Approach_Waypoint_" + a + "_Name", "string", wpa.name);
                    }
                }

                console.log("Flight Plan Processed (BASE ONLY):", this.flightPlanWaypoints);
                console.log("Approach Plan (SEPARATE):", this.approachWaypoints);
                console.log("Active Waypoint Index:", this.activeWaypointIndex);
            }

        } catch (err) {
            console.error("Error fetching flight plan:", err);
        } finally {
            this._fpFetchInFlight = false;
        }
    }

    // Derive final approach course from an approach waypoint list.
    // Returns degrees magnetic/true? -> It's a geometric course (true-ish). You can mag-correct later if needed.
    deriveFinalApproachCourseDeg(approachList) {
        if (!Array.isArray(approachList) || approachList.length < 2) return null;

        const isRunwayIdent = (ident) => {
            const s = String(ident || "").toUpperCase().trim();
            // Matches RW31, RW31L, RW04, RW04R, etc.
            return /^RW\d{2}[LRC]?$/.test(s);
        };

        // 1) Pick runway waypoint: last runway-like waypoint in the list
        let rwIndex = -1;
        for (let i = approachList.length - 1; i >= 0; i--) {
            if (isRunwayIdent(approachList[i].name)) {
                rwIndex = i;
                break;
            }
        }
        if (rwIndex < 0) {
            // Fallback: assume last point is runway if nothing matches
            rwIndex = approachList.length - 1;
        }

        // 2) FAF candidate: nearest valid fix before runway
        let fafIndex = -1;
        for (let i = rwIndex - 1; i >= 0; i--) {
            const wp = approachList[i];
            if (!wp) continue;
            if (!Number.isFinite(wp.lat) || !Number.isFinite(wp.lon)) continue;

            // Skip pseudo points if you have any conventions; add more filters if needed
            const n = String(wp.name || "").toUpperCase();
            if (n === "USER") continue;

            fafIndex = i;
            break;
        }
        if (fafIndex < 0) return null;

        const faf = approachList[fafIndex];
        const rw = approachList[rwIndex];

        // 3) Compute bearing FAF -> RW
        const crs = this.initialBearingDeg(faf.lat, faf.lon, rw.lat, rw.lon);

        // Normalize
        return (crs + 360) % 360;
    }

    connectedCallback() {
        super.connectedCallback();

        // Initialize the canvas for input events
        this.canvas = document.getElementById("mfdCanvas");
        if (this.canvas) {
            this.canvas.addEventListener('mousedown', e => this._touchStart(e), false);
            this.canvas.addEventListener('mouseup', e => this._touchEnd(e), false);
        }

        // Initialize SimVar and schedule updates
        if (typeof SimVar !== "undefined") {
            setInterval(() => this.Update(), 50);

            // Poll for knob deltas/buttons
            setInterval(() => {
                this.pollMFDKnobDeltas();
                this.pollMFDKnobButton();
            }, 50);

            const coherentInit = setInterval(() => {
                if (typeof Coherent !== "undefined" && typeof Coherent.call === "function") {
                    try {
                        if (typeof RegisterViewListener === "function") {
                            this.flightPlanListener = RegisterViewListener("JS_LISTENER_FLIGHTPLAN");
                        }
                    } catch (e) {
                        console.warn("RegisterViewListener threw, continuing without it:", e);
                    }

                    setInterval(async () => {
                        await this.getWaypoints();
                    }, 1000);

                    clearInterval(coherentInit);
                } else {
                    console.warn("Waiting for Coherent GT API...");
                }
            }, 100);
        } else {
            console.error("SimVar not found! SimVar operations won't work.");
        }

        this.terrainInit();

        this.initWttDataBridge();

        // Perform the initial update
        this.Update();
    }



    pollMFDKnobDeltas() {
        // Static variables to track last time and fast-spin state
        if (!this._knobLastSmallTime) this._knobLastSmallTime = 0;
        if (this._knobLastLargeValue === undefined) this._knobLastLargeValue = 0;

        const now = Date.now();

        let smallDelta = (typeof SimVar !== "undefined") ? SimVar.GetSimVarValue("L:MFD_KnobSmallDelta", "number") || 0 : 0;
        if (smallDelta !== 0) {
            let timeSince = now - this._knobLastSmallTime;
            this._knobLastSmallTime = now;

            // Fast spin: <70ms between events, normal: 70-250ms, slow: >250ms
            let step = 1;
            if (Math.abs(smallDelta) > 1) {
                // If hardware sends burst increments, apply all at once
                step = Math.abs(smallDelta);
            } else if (timeSince < 70) {
                step = 10;   // Very fast: rotate fast!
            } else if (timeSince < 250) {
                step = 3;    // Medium: rotate moderately fast
            }

            this.handleKnobDelta(step * Math.sign(smallDelta), "small");
            SimVar.SetSimVarValue("L:MFD_KnobSmallDelta", "number", 0);
        }

        let largeDelta = (typeof SimVar !== "undefined") ? SimVar.GetSimVarValue("L:MFD_KnobLargeDelta", "number") || 0 : 0;

        // Only act when the value changes from the last seen value.
        // This prevents one detent from being handled twice across polling frames.
        if (largeDelta !== 0 && largeDelta !== this._knobLastLargeValue) {
            const dir = Math.sign(largeDelta);
            this.handleKnobDelta(dir, "large");
            SimVar.SetSimVarValue("L:MFD_KnobLargeDelta", "number", 0);
        }

        this._knobLastLargeValue = largeDelta;
    }

    pollMFDKnobButton() {
        const now = Date.now();
        // Long press logic
        let btnLongVal = (typeof SimVar !== "undefined") ? SimVar.GetSimVarValue("L:MFD_KnobButtonLong", "number") || 0 : 0;
        let longHandled = false;
        if (btnLongVal === 1) {
            SimVar.SetSimVarValue("L:MFD_KnobButtonLong", "number", 0);
            // The release of a long press can also raise the short-press LVar (same or a later
            // poll cycle). Arm a one-shot suppression so it can't reopen the menu just closed.
            this._knobShortSuppressUntil = now + this.knobShortSuppressMs;
            longHandled = true;
            this.handleKnobSyncRaw();
        }

        // Short press logic
        let btnShortVal = (typeof SimVar !== "undefined") ? SimVar.GetSimVarValue("L:MFD_KnobButtonShort", "number") || 0 : 0;
        if (btnShortVal === 1) {
            SimVar.SetSimVarValue("L:MFD_KnobButtonShort", "number", 0);
            if (longHandled || now < this._knobShortSuppressUntil) {
                this._knobShortSuppressUntil = 0; // swallow only one short after a long
            } else {
                this.handleKnobShortPress();
            }
        }
    }

    handleKnobShortPress() {
        this.OptionsClick();
    }

    isTouchBoxEnabled(id) {
        // When options menu is open, ignore background touch targets
        if (this.shutdownActive) {
            return (
                id === "shutdown_now" ||
                id === "stay_on" ||
                id === "large_knob_cw" ||
                id === "large_knob_ccw" ||
                id === "small_knob_cw" ||
                id === "small_knob_ccw" ||
                id === "small_knob_button"
            );
        }

        if (this.showOptions) {
            return (
                id === "options_back" ||
                id === "options_btn_1" ||
                id === "options_btn_2" ||
                id === "options_btn_3" ||
                id === "large_knob_cw" ||
                id === "large_knob_ccw" ||
                id === "small_knob_cw" ||
                id === "small_knob_ccw" ||
                id === "small_knob_button"
            );
        }

        // Normal mode: everything enabled
        return true;
    }

    _touchStart(e) {

        this.TRKbox_timer.start();

        const rect = this.canvas.getBoundingClientRect();

        // 1) Get pointer in CSS pixels (rect space)
        const clientX = (e.touches && e.touches.length) ? e.touches[0].clientX : e.clientX;
        const clientY = (e.touches && e.touches.length) ? e.touches[0].clientY : e.clientY;

        const xCss = clientX - rect.left;
        const yCss = clientY - rect.top;

        // 2) Convert CSS pixels -> canvas pixels
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;

        const x = xCss * scaleX;
        const y = yCss * scaleY;

        // Find which touch box was hit
        this.touchedBox = null;
        for (const box of this.touchBoxes) {
            if (!this.isTouchBoxEnabled(box.id)) continue;

            if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
                this.touchedBox = box;
                this.debugText = box.id;
                break;
            }
        }

        if (!this.touchedBox) {
            this.Update();
            return;
        }

        // shutdown now
        if (this.touchedBox.id === "shutdown_now" && this.shutdownActive) {
            this.forceShutdownNow();
            this.Update();
            return;
        }

        if (this.touchedBox.id === "stay_on" && this.shutdownActive) {
            this.stayOnNow();
            this.Update();
            return;
        }

        // --- Normal (non-options-menu) touch targets ---
        if (this.touchedBox.id === "trk" && !this.showOptions) {
            this.activeBox = "trk";
        } else if (this.touchedBox.id === "crs" && !this.crsLock && !this.showOptions) {
            this.activeBox = "crs";
        } else if (this.touchedBox.id === "cdi" && !this.showOptions) {
            this.cycleNavSource();
        } else if (this.touchedBox.id === "map_range" && this.currentPage === "map" && !this.showOptions) {
            this.activeBox = "map_range";
        }

        // --- Options menu touch targets (Back + scrollable list rows) ---
        else if (this.touchedBox.id === "options_back") {
            this.activeBox = "options_back";
            this.optionsSelIndex = 0; // "Back" is now index 0 in getCurrentOptionsList()
        } else if (
            this.touchedBox.id === "options_btn_1" ||
            this.touchedBox.id === "options_btn_2" ||
            this.touchedBox.id === "options_btn_3"
        ) {
            this.activeBox = this.touchedBox.id;

            const row =
                (this.touchedBox.id === "options_btn_1") ? 0 :
                    (this.touchedBox.id === "options_btn_2") ? 1 : 2;

            const list = this.getCurrentOptionsList();
            const firstVisibleIndex = 1 + this.optionsScroll;   // skip Back (0)
            const idx = firstVisibleIndex + row;

            // If there's no item for that row, don't change selection
            if (idx >= 0 && idx < list.length) {
                this.optionsSelIndex = idx;
            } else {
            }
        }

        // --- Small knob button: long press handling ---
        if (this.touchedBox.id === "small_knob_button") {
            this.knobPressBox = this.touchedBox.id;
            this.knobLongPressFired = false;

            if (this.knobLongPressTimer) clearTimeout(this.knobLongPressTimer);
            this.knobLongPressTimer = setTimeout(() => {
                this.knobLongPressTimer = null;
                // Mark fired first so release can never fall through to a short press
                this.knobLongPressFired = true;
                this.handleKnobSyncRaw();
                this.Update();
            }, 2000);

        }

        // --- Knob hold repeat (small knob) ---
        if (this.touchedBox.id === "small_knob_cw") {
            this.knobHoldTimer = setInterval(() => this.handleKnobDelta(+1, "small"), 120);
            this.handleKnobDelta(+1, "small");
        } else if (this.touchedBox.id === "small_knob_ccw") {
            this.knobHoldTimer = setInterval(() => this.handleKnobDelta(-1, "small"), 120);
            this.handleKnobDelta(-1, "small");
        }

        // --- Knob hold repeat (large knob) ---
        if (this.touchedBox.id === "large_knob_cw") {
            this.knobHoldTimer = setInterval(() => this.handleKnobDelta(+1, "large"), 120);
            this.handleKnobDelta(+1, "large");
        } else if (this.touchedBox.id === "large_knob_ccw") {
            this.knobHoldTimer = setInterval(() => this.handleKnobDelta(-1, "large"), 120);
            this.handleKnobDelta(-1, "large");
        }

        this.Update();
    }

    _touchEnd(e) {
        // If we released on an options target, activate it
        if (this.touchedBox) {
            const id = this.touchedBox.id;

            if (id === "options_back") {
                this.showOptions = false;
                this.optionsLevel = 0;
                this.optionsParent = "";
                this.optionsScroll = 0;
                this.optionsSelIndex = 1;
                this.optionsEditing = false;
                this.optionsEditKey = "";
                this.menuHistory = [];
                this.touchedBox = null;
                this.Update();
                return;
            }

            if (id === "options_btn_1" || id === "options_btn_2" || id === "options_btn_3") {
                const row = (id === "options_btn_1") ? 0 : (id === "options_btn_2") ? 1 : 2;
                const list = this.getCurrentOptionsList();
                const firstVisibleIndex = 1 + this.optionsScroll;   // skip Back (0)
                const idx = firstVisibleIndex + row;

                if (idx >= 0 && idx < list.length) {
                    this.optionsSelIndex = idx;
                    this.OptionsClick();
                }
            }
        }

        // --- Small knob button: short vs long press ---
        if (this.knobPressBox === "small_knob_button") {
            if (this.knobLongPressTimer) {
                clearTimeout(this.knobLongPressTimer);
                this.knobLongPressTimer = null;
            }
            if (!this.knobLongPressFired) {
                this.handleKnobShortPress();
            }
        }

        this.knobPressBox = null;
        this.knobLongPressFired = false;

        if (this.knobHoldTimer) {
            clearInterval(this.knobHoldTimer);
            this.knobHoldTimer = null;
        }

        this.touchedBox = null;
        this.Update();
    }

    // --- ADD this helper alongside isCrsEditable()/adjustCrsBy() ---
    isTrkEditable() {
        // TRK bug is always editable (menu-driven)
        return true;
    }

    // --- ADD this helper alongside adjustCrsBy() ---
    adjustTrkBy(delta) {
        const step = Math.sign(delta);
        if (!step) return;

        const newTrk = (this.trkSel + step + 360) % 360;
        this.trkSel = newTrk;

        // Drive the sim + keep your test hook coherent
        if (typeof SimVar !== "undefined") {
            SimVar.SetSimVarValue("L:TRK_SEL", "Number", newTrk);
        }
        window.testTrack = newTrk;
    }

    handleKnobDelta(delta, size) {
        // don't timeout TRK box selection when turning knob
        if (this.TRKbox_timer.ON) this.TRKbox_timer.count = 0;

        if (size === "small") {
            if (this.showOptions) {
                const list = this.getCurrentOptionsList();
                const label = list[this.optionsSelIndex];

                // CRS submenu: edit CRS on the CRS row (if allowed)
                if (this.optionsLevel === 1 && this.optionsParent === "CRS Options" && label === "CRS") {
                    if (this.isCrsEditable()) this.adjustCrsBy(delta);
                }
                // TRK submenu: edit TRK on the TRK row
                else if (this.optionsLevel === 1 && this.optionsParent === "TRK Options" && label === "TRK") {
                    if (this.isTrkEditable()) this.adjustTrkBy(delta);
                }
                // Backlight submenu
                else if (this.optionsLevel === 1 && this.optionsParent === "Backlight") {
                    if (label === "Brighter") {
                        this.adjustMfdDimming(-Math.sign(delta || 1));
                        this.Update();
                        return;
                    } else if (label === "Dimmer") {
                        this.adjustMfdDimming(+Math.sign(delta || 1));
                        this.Update();
                        return;
                    }
                }
                // Otherwise, small knob navigates options list
                else {
                    this.optionsChange(delta);
                }

            } else if (this.activeBox === "trk") {
                if (this.trkHold) {
                    let newTrack = (this.trkSel + delta + 360) % 360;
                    this.trkSel = newTrack;
                    if (typeof SimVar !== "undefined") SimVar.SetSimVarValue("L:TRK_SEL", "Number", newTrack);
                    window.testTrack = newTrack;
                } else {
                    if (delta > 0) SimVar.SetSimVarValue("K:HEADING_BUG_INC", "number", 1);
                    else if (delta < 0) SimVar.SetSimVarValue("K:HEADING_BUG_DEC", "number", 1);
                }
                

            } else if (this.activeBox === "crs" && !this.crsLock) {
                let newCrs = (this.crsSel + delta + 360) % 360;
                this.crsSel = newCrs;
                if (typeof SimVar !== "undefined") {
                    if (this.selectedNavSource === "VOR1") {
                        if (delta > 0) SimVar.SetSimVarValue("K:VOR1_OBI_INC", "number", 1);
                        else if (delta < 0) SimVar.SetSimVarValue("K:VOR1_OBI_DEC", "number", 1);
                    } else if (this.selectedNavSource === "VOR2") {
                        if (delta > 0) SimVar.SetSimVarValue("K:VOR2_OBI_INC", "number", 1);
                        else if (delta < 0) SimVar.SetSimVarValue("K:VOR2_OBI_DEC", "number", 1);
                    }
                }
                window.testCrs = newCrs;

            } else if (this.activeBox === "map_range") {

                // Allowed discrete ranges
                const ranges = [0.01, 0.1, 1, 5, 10, 20, 30, 40, 75, 100, 200, 500];

                // Find current index, snap to nearest if not exact
                let idx = ranges.indexOf(this.mapRange);
                if (idx === -1) {
                    let nearest = 0;
                    for (let i = 1; i < ranges.length; i++) {
                        if (Math.abs(ranges[i] - this.mapRange) < Math.abs(ranges[nearest] - this.mapRange)) {
                            nearest = i;
                        }
                    }
                    idx = nearest;
                }

                // One step per event — ignore acceleration magnitude
                const move = delta > 0 ? 1 : -1;
                const newIdx = Math.max(0, Math.min(ranges.length - 1, idx + move));

                if (newIdx !== idx) {
                    this.mapRange = ranges[newIdx];
                }
            }

        } else if (size === "large") {
            if (this.showOptions) {
                this.optionsChange(delta); // large knob moves selection in options
            } else {
                if (delta > 0) this.nextPage();
                else if (delta < 0) this.previousPage();
            }
        }

        this.Update();
    }

    adjustCrsBy(delta) {
        const step = Math.sign(delta);
        if (!step) return;

        const newCrs = (this.crsSel + step + 360) % 360;
        this.crsSel = newCrs;

        if (typeof SimVar !== "undefined") {
            if (this.selectedNavSource === "GPS") {
                // GPS CRS editing only makes sense in OBS; drive the sim OBS value
                // (Most setups respond to K:GPS_OBS_INC/DEC, but you’re currently reading GPS OBS VALUE)
                if (step > 0) SimVar.SetSimVarValue("K:GPS_OBS_INC", "number", 1);
                else SimVar.SetSimVarValue("K:GPS_OBS_DEC", "number", 1);
            } else if (this.selectedNavSource === "VOR1") {
                if (step > 0) SimVar.SetSimVarValue("K:VOR1_OBI_INC", "number", 1);
                else SimVar.SetSimVarValue("K:VOR1_OBI_DEC", "number", 1);
            } else if (this.selectedNavSource === "VOR2") {
                if (step > 0) SimVar.SetSimVarValue("K:VOR2_OBI_INC", "number", 1);
                else SimVar.SetSimVarValue("K:VOR2_OBI_DEC", "number", 1);
            }
        }
    }

    getCurrentOptionsList() {
        // Root menu
        if (this.optionsLevel === 0) {
            return ["Back", ...this.optionsRoot];
        }

        // Child menu
        const child = this.optionsChildren[this.optionsParent] || [];
        return ["Back", ...child];
    }

    getVisibleOptionLabel(row) {
        // row: 0 for btn_1, 1 for btn_2
        const list = this.getCurrentOptionsList();
        const idx = this.optionsScroll + row;
        return (idx >= 0 && idx < list.length) ? list[idx] : "";
    }

    OptionsClick() {

        this.lastInteractionTime = Date.now();

        // Open menu if currently closed
        if (!this.showOptions) {
            this.showOptions = true;
            this.optionsScroll = 0;
            this.optionsSelIndex = 1; // first real option (Back is 0)
            this.optionsLevel = 0;
            this.optionsParent = "";
            this.menuHistory = []; // Reset history stack
            return;
        }

        const list = this.getCurrentOptionsList();
        const label = list[this.optionsSelIndex];
        if (!label) return;

        // Back behavior: pop the history stack for nested submenus (e.g. Misc. Field -> Wind Settings)
        if (label === "Back") {
            if (this.menuHistory && this.menuHistory.length > 0) {
                this.optionsParent = this.menuHistory.pop();
                this.optionsLevel = this.menuHistory.length;
                this.optionsScroll = 0;
                this.optionsSelIndex = 1;
            } else if (this.optionsLevel > 0) {
                // go back to root menu
                this.optionsLevel = 0;
                this.optionsParent = "";
                this.optionsScroll = 0;
                this.optionsSelIndex = 1;
            } else {
                // close menu
                this.showOptions = false;
            }
            this.Update();
            return;
        }

        // Enter submenus (any label that owns a child list), tracking history so
        // nested menus (e.g. Misc. Field -> Wind Settings) can back out correctly.
        if (this.optionsChildren[label]) {
            if (!this.menuHistory) this.menuHistory = [];
            this.menuHistory.push(this.optionsParent); // Save current level

            this.optionsLevel = this.menuHistory.length;
            this.optionsParent = label;
            this.optionsScroll = 0;
            this.optionsSelIndex = 1; // first item in submenu
            this.Update();
            return;
        }

        // Root toggles / actions
        if (label === "Bearing 1") this.cycleRmiSource(1, +1);
        else if (label === "Bearing 2") this.cycleRmiSource(2, +1);
        else if (label === "CDI/VDI Preview") this.cdiVdiPreviewOn = !this.cdiVdiPreviewOn;
        else if (label === "LOC CDI Prompt") this.locCdiPromptOn = !this.locCdiPromptOn;

        if (this.optionsParent === "Backlight") {
            if (label === "Brighter") {
                this.adjustMfdDimming(-1);
                return;
            }
            if (label === "Dimmer") {
                this.adjustMfdDimming(+1);
                return;
            }
        }

        if (this.optionsParent === "Misc. Field") {
            if (label === "Off") {
                this.miscOption = -1;
            } else if (label in this.miscFieldMapping) {
                // Toggle OFF if already selected, otherwise turn ON
                const mapped = this.miscFieldMapping[label];
                this.miscOption = (this.miscOption === mapped) ? -1 : mapped;
            }
            if (typeof SimVar !== "undefined") {
                SimVar.SetSimVarValue("L:MFD_Misc.1", "number", this.miscOption);
            }
            this.Update();
            return;
        }

        if (this.optionsParent === "Wind Settings") {
            if (label in this.windFieldMapping) {
                this.windOption = this.windFieldMapping[label];
                if (typeof SimVar !== "undefined") {
                    SimVar.SetSimVarValue("L:MFD_Wind_Style.1", "number", this.windOption);
                }
            }
            this.Update();
            return;
        }

        this.Update();
    }

    isCrsEditable() {
        // Editable when:
        // - VOR1/VOR2 always editable
        // - GPS only editable when OBS is active
        if (this.selectedNavSource === "GPS") {
            return !!this.gpsObsActive;
        }
        return (this.selectedNavSource === "VOR1" || this.selectedNavSource === "VOR2");
    }

    updateOptionsAutoClose() {
        if (!this.showOptions) return;

        if ((Date.now() - this.lastInteractionTime) > this.optionsAutoCloseMs) {
            this.showOptions = false;
            this.optionsLevel = 0;
            this.optionsParent = "";
            this.optionsScroll = 0;
            this.optionsSelIndex = 1;
            this.optionsEditing = false;
            this.optionsEditKey = "";
            this.menuHistory = [];
        }
    }

    optionsChange(delta) {

        this.lastInteractionTime = Date.now();

        const list = this.getCurrentOptionsList();
        if (!list || list.length === 0) return;

        const step = Math.sign(delta);
        if (step === 0) return;

        const max = list.length - 1;

        // WRAP selection: 0..max
        this.optionsSelIndex = (this.optionsSelIndex + step + (max + 1)) % (max + 1);

        // Maintain scroll window, but only for indices 1..max (Back doesn't scroll)
        if (this.optionsSelIndex === 0) {
            // when Back selected, keep scroll at top
            this.optionsScroll = 0;
            return;
        }

        const firstVisible = 1 + this.optionsScroll;
        const lastVisible = firstVisible + (this.optionsVisibleRows - 1);

        if (this.optionsSelIndex < firstVisible) {
            this.optionsScroll = this.optionsSelIndex - 1;
        } else if (this.optionsSelIndex > lastVisible) {
            this.optionsScroll = this.optionsSelIndex - 1 - (this.optionsVisibleRows - 1);
        }

        // Clamp scroll so rows stay within 1..max
        const maxScroll = Math.max(0, (max - 1) - (this.optionsVisibleRows - 1));
        this.optionsScroll = Math.max(0, Math.min(maxScroll, this.optionsScroll));
    }


    // Function to show page dots and hide after 5 seconds
    // Replace showPageDots with a version that controls canvas rendering via the flag
    showPageDots() {
        this.pageDotsVisible = true;
        clearTimeout(this.pageDotsTimeout);
        this.pageDotsTimeout = setTimeout(() => {
            this.pageDotsVisible = false;
            this.Update(); // trigger redraw to hide dots
        }, 5000);
    }

    nextPage() {
        const currentIndex = this.getCurrentPageIndex();
        // Only advance if not at the last page
        if (currentIndex < this.pages.length - 1) {
            this.currentPage = this.pages[currentIndex + 1];
            this.showPageDots(); // Show page dots when page changes
        }
        this.Update();
    }

    previousPage() {
        const currentIndex = this.getCurrentPageIndex();
        // Only go back if not at the first page
        if (currentIndex > 0) {
            this.currentPage = this.pages[currentIndex - 1];
            this.showPageDots(); // Show page dots when page changes
        }
        this.Update();
    }

    getCurrentPageIndex() {
        return this.pages.indexOf(this.currentPage);
    }

    // --- Unified SYNC LOGIC (track/course, raw data) ---
    handleKnobSyncRaw() {
        // If options menu is open, long press closes it
        if (this.showOptions) {
            this.showOptions = false;
            this.optionsLevel = 0;
            this.optionsParent = "";
            this.optionsScroll = 0;
            this.optionsSelIndex = 1;
            this.optionsEditing = false;
            this.optionsEditKey = "";
            this.menuHistory = [];
            this.Update();
            return;
        }

        if (this.activeBox === "trk") {
            if (this.trkHold === 0) {
                SimVar.SetSimVarValue("K:HEADING_BUG_SET", "number", this.heading);
            } else {
                this.trkSel = this.trackMag;
                if (typeof SimVar !== "undefined") {
                    SimVar.SetSimVarValue("L:TRK_SEL", "Number", this.trkSel);
                }
            }
            
        } else if (this.activeBox === "crs") {
            if (this.selectedNavSource === "GPS") {
                if (this.HdgTrk === 0) {
                    this.crsSel = this.heading;
                } else {
                    this.crsSel = this.trackMag;
                }
                
                if (typeof SimVar !== "undefined") {
                    SimVar.SetSimVarValue("L:CRS_SEL", "Number", this.crsSel);
                }
            } else if (this.selectedNavSource === "VOR1" || this.selectedNavSource === "VOR2") {
                this.centerVORCourseToStation();
            }
        }
    }

    cycleNavSource() {
        if (this.selectedNavSource === "GPS") {//select VOR1
            this.selectedNavSource = "VOR1";
            this.lastNavSource = "VOR1";
            //SimVar.SetSimVarValue("GPS DRIVES NAV1", "Bool", 0);
            SimVar.SetSimVarValue("K:TOGGLE_GPS_DRIVES_NAV1", "number", 0);
            SimVar.SetSimVarValue("K:AP_NAV_SELECT_SET", "number", 1);
        } else if (this.selectedNavSource === "VOR1") {//select VOR2
            this.selectedNavSource = "VOR2";
            this.lastNavSource = "VOR2";
            SimVar.SetSimVarValue("GPS DRIVES NAV1", "Bool", 0);
            SimVar.SetSimVarValue("K:AP_NAV_SELECT_SET", "number", 2);
        } else {//select GPS
            this.selectedNavSource = "GPS";
            this.lastNavSource = "VOR1";//this allows cycling back to VOR1 if changed to VOR in the sim
            //SimVar.SetSimVarValue("GPS DRIVES NAV1", "Bool", 1);
            SimVar.SetSimVarValue("K:TOGGLE_GPS_DRIVES_NAV1", "number", 0);
        }

        this.Update();
    }

    centerVORCourseToStation() {
        let track;
        if (this.HdgTrk === 0) {
            track = this.heading;
        } else {
            track = this.trackMag;
        }
        
        if (this.selectedNavSource === "VOR1") {
            const relBearingRad = Number(SimVar.GetSimVarValue("NAV RELATIVE BEARING TO STATION:1", "radians")) || 0;
            const relBearingDeg = relBearingRad * (180 / Math.PI);
            const desiredCourse = ((track + relBearingDeg + 360) % 360);
            this.crsSel = desiredCourse;
            SimVar.SetSimVarValue("L:CRS_SEL", "Number", desiredCourse);
            SimVar.SetSimVarValue("K:VOR1_SET", "number", Math.round(desiredCourse));
        } else if (this.selectedNavSource === "VOR2") {
            const relBearingRad = Number(SimVar.GetSimVarValue("NAV RELATIVE BEARING TO STATION:2", "radians")) || 0;
            const relBearingDeg = relBearingRad * (180 / Math.PI);
            const desiredCourse = ((track + relBearingDeg + 360) % 360);
            this.crsSel = desiredCourse;
            SimVar.SetSimVarValue("L:CRS_SEL_2", "Number", desiredCourse);
            SimVar.SetSimVarValue("K:VOR2_SET", "number", Math.round(desiredCourse));
        }
        this.Update();
    }


    drawCompassCard(ctx, cx, cy, R) {
        const img = this.images.compassImg;
        if (!img || !img.complete || img.naturalWidth <= 0) return;

        // --- 1) Draw rotating compass card (your existing behavior) ---
        ctx.save();
        ctx.translate(cx, cy);

        if (this.HdgTrk === 0) {
            // HDG-up presentation: card rotated by -heading
            ctx.rotate(-(Number(this.heading) || 0) * Math.PI / 180);
        } else {
            // TRK-up presentation: card rotated by -ground track
            ctx.rotate(-(Number(this.trackMag) || 0) * Math.PI / 180);
        }

        // Base size (your existing design)
        const baseSize = R * 2;

        // Scale for the new 400x400 asset vs old 320x320 (400/320 = 1.25)
        const assetScale = 1.25;

        // Extra overscan to ensure corners are fully covered when rotated
        const overscan = 1.05;

        const size = baseSize * assetScale * overscan;
        ctx.drawImage(img, -size / 2, -size / 2, size, size);

        ctx.restore();
    }

    drawGroundTrackLine(ctx, cx, cy) {
        if (!ctx) return;

        const hdg = Number(this.heading) || 0;
        const trk = Number(this.trackMag) || 0;

        // shortest signed angular difference [-180..+180]
        const deltaDeg = (((trk - hdg) + 540) % 360) - 180;

        // If HDG-up: rotate marker to show actual track vs heading.
        // If TRK-up: track is already "up", so no rotation.
        const markerRotRad = (this.HdgTrk === 0) ? (deltaDeg * Math.PI / 180) : 0;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(markerRotRad);

        ctx.strokeStyle = "#ff00ff";
        ctx.lineCap = "butt";

        // Keep your existing geometry (absolute Y’s converted to local offsets)
        const startY = 65;
        const endY = 35;

        const y1 = startY - cy;
        const y2 = endY - cy;

        // Main line
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(0, y1);
        ctx.lineTo(0, y2);
        ctx.stroke();

        // Tip stroke
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(0, y1);
        ctx.lineTo(0, (endY - 3) - cy);
        ctx.stroke();

        ctx.restore();
    }

    drawHSILayer2(ctx, cx, cy, R) {
        const img = this.images.hsiLayer2Img;
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.drawImage(img, -R, -R, R * 2, R * 2);
            ctx.restore();
        }
    }
    drawBug(ctx, cx, cy, R) {
        const img = this.images.bugImg;
        let angle = 0;
        if (this.HdgTrk === 0) {
            if (this.trkHold) {
                angle = (this.trkSel - this.heading) * Math.PI / 180;
            } else {//heading hold
                angle = (this.hdgSel - this.heading) * Math.PI / 180;
            }
            
        } else {
            if (this.trkHold) {
                angle = (this.trkSel - this.trackMag) * Math.PI / 180;
            } else {//heading hold
                angle = (this.hdgSel - this.trackMag) * Math.PI / 180;
            }
            
        }

        let bugRadius = R - 2;
        let x = cx + bugRadius * Math.sin(angle);
        let y = cy - bugRadius * Math.cos(angle);
        if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.drawImage(img, -12, -12, 24, 24);
            ctx.restore();
        }
    }


    drawHeadingBox(ctx, cx) {
        const boxW = 30, boxH = 36, boxY = 60;
        ctx.save();
        ctx.font = "bold 16px Arial";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        let txt = "";
        if (this.HdgTrk === 0) {
            txt = Math.round(this.heading).toString().padStart(3, "0");
        } else {
            txt = Math.round(this.trackMag).toString().padStart(3, "0");
        }
        
        ctx.fillText(txt, cx, boxY + (boxH / 2) - 1);

        // Draw degree symbol (small circle) to upper right of the text
        let txtMetrics = ctx.measureText(txt);
        let degreeRadius = 3; // You can make this bigger/smaller
        let degreeX = cx + (txtMetrics.width / 2) + degreeRadius + 2; // +2px spacing from text
        let degreeY = boxY + (boxH / 2) - 8; // Higher than text, -8 for good effect

        this.drawDegreeSymbol(ctx, degreeX, degreeY, degreeRadius);

        ctx.restore();
    }


    drawHDGTRKAnnunciation(ctx) {
        if (!ctx || !this.canvas) return;

        const canvasW = this.canvas.width;
        const canvasH = this.canvas.height;

        // Top area geometry
        const pointerX = Math.round(canvasW / 2) + 0;
        const tapeTop = canvasH - 225;
        const tapeHeight = 22;
        let txt = "";
        let txtCenter = 0;
        if (this.HdgTrk === 0) {
            txtCenter = Math.round(this.heading || 0) % 360;
            txt = (txtCenter === 0 ? "360" : String(txtCenter).padStart(3, "0"));
        } else {
            txtCenter = Math.round(this.trackMag || 0) % 360;
            txt = (txtCenter === 0 ? "360" : String(txtCenter).padStart(3, "0"));
        }
        

        // Measure numeric text width using the same font we'll draw with
        ctx.save();
        ctx.font = "bold 20px Arial";
        const txtW = ctx.measureText(txt).width;
        ctx.restore();

        // numeric bg geometry
        const bgW = txtW + 12, bgH = 24;
        const bgX = pointerX - bgW / 2, bgY = tapeTop - bgH - 6;

        // LEFT small HDGTRK box placed to the left of the numeric background
        const trkBoxW = 30, trkBoxH = 16;
        const gap = -2; // negative gap to slightly overlap
        const trkBoxX = bgX - trkBoxW - gap;
        const trkBoxY = Math.round(bgY + (bgH - trkBoxH) / 2) + 4;

        // --- Draw HDGTRK box first (so numeric bg drawn afterwards can cover part of it) ---
        ctx.save();
        ctx.fillStyle = "#000";
        ctx.fillRect(trkBoxX, trkBoxY, trkBoxW, trkBoxH);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#fff";
        //ctx.strokeRect(trkBoxX, trkBoxY, trkBoxW, trkBoxH);
        this.drawRoundedRect(ctx, trkBoxX, trkBoxY, trkBoxW, trkBoxH, 4, "#000");
        ctx.font = "10px Arial";
        ctx.fillStyle = "#26c6ff"; // light blue
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (this.HdgTrk === 0) {
            ctx.fillText("HDG", trkBoxX + trkBoxW / 2, trkBoxY + trkBoxH / 2 + 1);
        } else {
            ctx.fillText("TRK", trkBoxX + trkBoxW / 2, trkBoxY + trkBoxH / 2 + 1);
        }
        
        ctx.restore();

        // --- Draw numeric background box (black w/ white border) overlapping TRK box ---
        ctx.save();
        ctx.fillStyle = "#000";
        ctx.fillRect(bgX, bgY, bgW, bgH);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#fff";
        //ctx.strokeRect(bgX, bgY, bgW, bgH);
        this.drawRoundedRect(ctx, bgX, bgY, bgW, bgH, 4, "#000");

        // Draw magenta TRK numeric (without degree symbol) centered, then draw degree symbol
        ctx.font = "bold 20px Arial";
        ctx.fillStyle = "#ff00ff"; // magenta
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const textY = bgY + bgH / 2 + 1;
        ctx.fillText(txt, pointerX - 5, textY);

        // Degree symbol drawn using drawDegreeSymbol to match TRK/CRS boxes
        // Position it slightly to the right of the numeric text
        const degX = pointerX + (txtW / 2) + 5;
        const degY = textY - 8;
        this.drawDegreeSymbol(ctx, degX - 5, degY, 2);

        ctx.restore();
    }

    drawHDGTRKBox(ctx, cx, cy, R) {
        const boxW = 35, boxH = 25, boxX = cx - 65, boxY = cy + 64;
        ctx.save();

        // Background so it stands out on the map page
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.fillRect(boxX, boxY, boxW, boxH);

        ctx.lineWidth = 3;
        ctx.strokeStyle = this.activeBox === "trk" ? "#00eaff" : "#225";
        this.drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 4);

        // Label
        ctx.font = "10px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#fff";
        if (this.trkHold === 0) {
            ctx.fillText("HDG", boxX + 3, boxY + 2);
        } else {
            ctx.fillText("TRK", boxX + 3, boxY + 2);
        }
        

        // Value
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#26c6ff";
        let txt;
        if (this.trkHold === 0) {
            txt = Math.round(this.hdgSel).toString().padStart(3, "0");
        } else {
            txt = Math.round(this.trkSel).toString().padStart(3, "0");
        }
        
        const txtX = (boxX + boxW / 2) - 3;
        const txtY = boxY + boxH / 2 + 6;
        ctx.fillText(txt, txtX, txtY);

        // Degree symbol
        let txtMetrics = ctx.measureText(txt);
        let degX = txtX + (txtMetrics.width / 2) + 5;
        let degY = txtY - 7;
        this.drawDegreeSymbol(ctx, degX, degY + 5, 2);

        ctx.restore();
    }

    drawCrsBox(ctx, cx, cy, R) {
        const boxW = 35, boxH = 25, boxX = cx + 33, boxY = cy + 64;
        ctx.save();

        // Background so it stands out on the map page
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.fillRect(boxX, boxY, boxW, boxH);

        //ctx.beginPath();
        //ctx.rect(boxX, boxY, boxW, boxH);
        ctx.lineWidth = 3;
        const isActive = this.activeBox === "crs";
        const crsTextColor = (this.selectedNavSource === "GPS") ? "#e049b0" : "#00ff00";
        ctx.strokeStyle = isActive ? "#00eaff" : "#225";
        //ctx.stroke();
        this.drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 4);

        // Label
        ctx.font = "10px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#fff";//white
        ctx.fillText("CRS", boxX + 3, boxY + 2);

        // Value
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = crsTextColor;
        const txt = Math.round(this.crsSel).toString().padStart(3, "0");
        const txtX = (boxX + boxW / 2) - 3;
        const txtY = boxY + boxH / 2 + 6;
        ctx.fillText(txt, txtX, txtY);

        // Degree symbol
        let txtMetrics = ctx.measureText(txt);
        let degX = txtX + (txtMetrics.width / 2) + 5;
        let degY = txtY - 7;
        this.drawDegreeSymbol(ctx, degX, degY + 5, 2);

        ctx.restore();
    }

    drawHSICourseNeedleAndCDI(ctx, cx, cy, R) {
        const course = Number(this.courseToDraw) || 0;
        let track;
        if (this.HdgTrk === 0) {
            track = Number(this.heading) || 0;
        } else {
            track = Number(this.trackMag) || 0;
        }

        // The rotation angle of the entire needle assembly
        const angleRad = (course - track) * Math.PI / 180;

        if (isNaN(angleRad)) return;

        // --- Active CDI Data ---
        const cdiRaw = (this.cdiNeedleValid && Number.isFinite(this.cdiDeflection)) ? this.cdiDeflection : 0;
        const toFromFlag = Math.round(this.toFromFlag);
        const courseColor = (this.selectedNavSource === "GPS") ? "#e049b0" : "#00ff00";

        // --- Geometry ---
        const needleWidth = 4, needleLen = R * 0.95;
        const gapRadius = R * 0.4, gapPx = R * 0.15;
        const gapOuter = gapRadius + gapPx / 2;
        const cdiMaxDots = 2, cdiDotSpacing = R * 0.19;
        const cdiLen = gapPx * 3.5, dotsRadius = 6;

        ctx.save();
        try {
            // 1. Shift canvas to center and apply ONE rigid rotation for the entire assembly
            ctx.translate(cx, cy);
            ctx.rotate(angleRad);

            // --- Draw Active CDI/Needle ---
            ctx.strokeStyle = courseColor;
            ctx.lineWidth = needleWidth;
            ctx.lineCap = "butt";

            // 2. Draw Outer Needle (Top Half)
            ctx.beginPath();
            ctx.moveTo(0, -needleLen);
            ctx.lineTo(0, -gapOuter);
            ctx.stroke();

            // 3. Draw Outer Needle (Bottom Half)
            ctx.beginPath();
            ctx.moveTo(0, needleLen);
            ctx.lineTo(0, gapOuter);
            ctx.stroke();

            // 5. Draw CDI Scale Dots (shared by both active and preview)
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 3.0;
            for (let i = -cdiMaxDots; i <= cdiMaxDots; i++) {
                if (i === 0) continue;
                ctx.beginPath();
                ctx.arc(i * cdiDotSpacing, 0, dotsRadius, 0, Math.PI * 2);
                ctx.stroke();
            }

            // 6. Draw Outer Triangle (Arrow tip for active needle)
            const triWidth = needleWidth * 5;
            const triLen = 8;
            ctx.beginPath();
            ctx.moveTo(0, -needleLen);
            ctx.lineTo(-triWidth / 2, -(needleLen - triLen));
            ctx.lineTo(triWidth / 2, -(needleLen - triLen));
            ctx.closePath();
            ctx.fillStyle = courseColor;
            ctx.fill();

            // 7. Draw TO/FROM Triangles (for active needle only)
            if (this.cdiNeedleValid) {
                const tfWidth = needleWidth * 6;
                const tfLen = 15;
                if (toFromFlag < 2) { // TO
                    const tfY = -(needleLen * 0.45);
                    ctx.beginPath();
                    ctx.moveTo(0, tfY);
                    ctx.lineTo(-tfWidth / 2, tfY + tfLen);
                    ctx.lineTo(tfWidth / 2, tfY + tfLen);
                    ctx.closePath();
                    ctx.fill();
                } else if (toFromFlag === 2) { // FROM
                    const tfY = (needleLen * 0.45);
                    ctx.beginPath();
                    ctx.moveTo(0, tfY);
                    ctx.lineTo(-tfWidth / 2, tfY - tfLen);
                    ctx.lineTo(tfWidth / 2, tfY - tfLen);
                    ctx.closePath();
                    ctx.fill();
                }
            }

            // --- 8. Draw Preview CDI (if active) ---
            if (this.isPreviewActive) {
                const previewCdiRaw = this.previewCdiDeflection;
                const previewCdiNorm = Math.max(-127, Math.min(127, previewCdiRaw)) / 127 * cdiMaxDots;
                const previewCdiOffset = previewCdiNorm * cdiDotSpacing;

                ctx.save();
                ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
                ctx.globalAlpha = 0.5; // Ghosted appearance
                ctx.lineWidth = needleWidth;
                ctx.lineCap = "round";

                ctx.beginPath();
                ctx.moveTo(previewCdiOffset, cdiLen / 2);
                ctx.lineTo(previewCdiOffset, -cdiLen / 2);
                ctx.stroke();
                ctx.restore();
            }

            // 4. Draw the center CDI Bar (Active)
            let cdiNorm = Math.max(-127, Math.min(127, cdiRaw)) / 127 * cdiMaxDots;
            let cdiOffset = cdiNorm * cdiDotSpacing;

            ctx.strokeStyle = courseColor;
            ctx.beginPath();
            ctx.moveTo(cdiOffset, cdiLen / 2);
            ctx.lineTo(cdiOffset, -cdiLen / 2);
            ctx.lineCap = "round";
            ctx.stroke();

        } catch (e) {
            console.error("Gauge Render Error in drawHSICourseNeedleAndCDI:", e);
        } finally {
            ctx.restore();
        }
    }



    drawNeedleTriangle(ctx, cx, cy, angleRad, radius, triWidth, color, triLen = 10, flip = false) {
        const perpRad = angleRad + Math.PI / 2;
        // Math logic stays the same...
        const tipR = radius;
        const baseR = flip ? radius + triLen : radius - triLen;
        const tipX = cx + tipR * Math.sin(angleRad);
        const tipY = cy - tipR * Math.cos(angleRad);
        const baseX = cx + baseR * Math.sin(angleRad);
        const baseY = cy - baseR * Math.cos(angleRad);

        const base1X = baseX - triWidth / 2 * Math.sin(perpRad);
        const base1Y = baseY + triWidth / 2 * Math.cos(perpRad);
        const base2X = baseX + triWidth / 2 * Math.sin(perpRad);
        const base2Y = baseY - triWidth / 2 * Math.cos(perpRad);

        // REMOVED ctx.save()
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(base1X, base1Y);
        ctx.lineTo(base2X, base2Y);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 1.0;
        ctx.fill();
        // REMOVED ctx.restore()
    }


    // Complete drawNavSource (previously truncated)
    drawNavSource(ctx, cx, cy, R) {
        // Instead of selectedNavSource, show navSourceText which can be ILS1, LOC1, VOR1, GPS, etc
        const navSourceText = this.navSourceText || this.selectedNavSource;
        const navSourceColor = (navSourceText === "GPS") ? this.identColor : "#00ff00";

        ctx.save();
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = navSourceColor;
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.fillText(navSourceText, cx - R * 0.50, cy - R * 0.20);

        // Phase text (right side)
        if (navSourceText === "GPS") {
            ctx.font = "bold 14px Arial";
            ctx.textAlign = "left";
            ctx.fillStyle = this.magenta;
            ctx.fillText(this.phaseText || "", cx + R * 0.20, cy - R * 0.20);
        }

        ctx.restore();
    }

    drawObsText(ctx, cx, cy, R) {
        if (this.selectedNavSource === "GPS" && this.gpsObsActive) {
            ctx.save();
            ctx.font = "bold 16px Arial";
            ctx.textAlign = "right";
            ctx.textBaseline = "bottom";
            ctx.fillStyle = "#e049b0";
            ctx.shadowColor = "black";
            ctx.shadowBlur = 4;
            ctx.fillText("OBS", cx + R * 0.5, cy + R * .17);//0.33);
            ctx.restore();
        }
    }

    drawCenterAirplane(ctx, cx, cy) {
        ctx.save();
        ctx.translate(cx, cy);

        // --- Aircraft symbol (slimmer fuselage, all magenta) ---
        ctx.fillStyle = "#ff00ff";
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(0, -11);   // nose
        ctx.lineTo(2, -3);
        ctx.lineTo(11, -1);   // right wing tip
        ctx.lineTo(11, 1);
        ctx.lineTo(2, 3);
        ctx.lineTo(2, 8);
        ctx.lineTo(5, 10);    // right tailplane
        ctx.lineTo(5, 12);
        ctx.lineTo(0, 10);    // tail center
        ctx.lineTo(-5, 12);   // left tailplane
        ctx.lineTo(-5, 10);
        ctx.lineTo(-2, 8);
        ctx.lineTo(-2, 3);
        ctx.lineTo(-11, 1);   // left wing tip
        ctx.lineTo(-11, -1);
        ctx.lineTo(-2, -3);
        ctx.closePath();

        ctx.fill();
        ctx.restore();
    }

    drawCenterTrackArrow(ctx, cx, cy) {
        ctx.save();
        ctx.translate(cx, cy);

        ctx.strokeStyle = "#26c6ff";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // short shaft, disconnected from arrowhead
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(0, -8);   // 10 px long
        ctx.stroke();

        // open arrow head (^), separated from shaft
        ctx.beginPath();
        ctx.moveTo(-3, -15);
        ctx.lineTo(0, -18);
        ctx.lineTo(3, -15);
        ctx.stroke();

        ctx.restore();
    }

    // Complete drawWaypointIdent (if you still use it)
    drawWaypointIdent(ctx, cx, cy, R) {
        if (!this.waypointIdent) return;
        ctx.save();
        ctx.font = "bold 14px Arial"; // fixed typo: was "nold"
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = this.identColor;
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;

        const identX = cx - R * 0.6;
        const identY = cy + R * 0.05;
        ctx.fillText(this.waypointIdent, identX, identY);
        ctx.restore();
    }

    drawBezel(ctx, w, h) {
        ctx.save();
        ctx.drawImage(this.images.bezelImg, 0, 0, w, h);
        ctx.restore();
    }

    drawDisEte(ctx, cx, cy, R) {
        if (this.cdiNeedleValid) {
            ctx.save();
            ctx.font = "bold 14px Arial";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            const disLabelX = cx - R * 0.6;
            const disLabelY = cy + R * 0.2;

            let distance = parseFloat(this.distanceToNext);
            // Clamp tiny negatives to zero
            if (isNaN(distance) || this.distanceToNext === "") {
                distance = "";
            } else if (Math.abs(distance) < 0.05) {
                distance = 0.0;
            }
            let disStr = distance !== "" ? distance.toFixed(1) : "";

            ctx.fillStyle = "#26c6ff"; // light blue
            ctx.fillText("DIS:", disLabelX, disLabelY);
            ctx.fillStyle = this.identColor;
            ctx.fillText(disStr + "NM", disLabelX + 30, disLabelY);

            ctx.fillStyle = "#26c6ff"; // light blue
            ctx.textAlign = "right";
            const eteLabelX = cx + R * 0.3;
            ctx.fillText("ETE:", eteLabelX, disLabelY);
            ctx.fillStyle = this.identColor;
            ctx.fillText(this.eteToNextStr, eteLabelX + 40, disLabelY);
            ctx.restore();
        }

    }

    drawVDI(ctx, cx, cy, R) {
        const showActive = this.vtgValid && this.vtgType;
        const showPreview = this.isPreviewActive && this.previewVtgValid;

        // Exit early if there's nothing to draw.
        if (!showActive && !showPreview) {
            return;
        }

        // --- Common Geometry ---
        const tapeWidth = 16;
        const tapeHeight = R * 1.18;
        const tapeX = cx + R * 0.6;
        const tapeY = cy - tapeHeight / 2 - 2;
        const dotsTotal = 2.2;
        const dotSpacing = tapeHeight / 6;
        const verticalFineTune = 12; // Pixels

        // --- Draw Background Scale and Label ---
        const img = this.images.cdiVertImg; // Assuming 'cdiVertImg' is your tape background.
        if (img && img.complete) {
            ctx.drawImage(img, tapeX, tapeY, tapeWidth, tapeHeight);
        }

        // The top character ('G' or 'V') should reflect the active source if available,
        // otherwise it should be a cyan 'G' for the preview source.
        const topChar = showActive ? (this.vtgType === 'VNAV' ? 'V' : 'G') : 'G';
        const topCharColor = showActive
            ? (this.vtgType === 'GP' || this.vtgType === 'VNAV' ? this.magenta : "#00ff00")
            : this.lightBlue; // Cyan if only preview is showing.

        ctx.save();
        ctx.font = "bold 15px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = topCharColor;
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.fillText(topChar, tapeX + tapeWidth / 2, tapeY + 3);
        ctx.restore();

        // --- Helper to draw a VDI marker ---
        const drawVdiMarker = (deflection, color, isFilled, isVnav) => {
            const defl = Math.max(-127, Math.min(127, deflection)) / 127 * dotsTotal;
            const markerY = tapeY + tapeHeight / 2 + defl * dotSpacing + verticalFineTune;

            ctx.save();
            ctx.translate(tapeX + tapeWidth / 2, markerY);

            if (isVnav) {
                // VNAV: Open horizontal "V" pointing left.
                ctx.beginPath();
                ctx.moveTo(-7, 0); // Tip of the V
                ctx.lineTo(7, -9); // Top right arm
                ctx.moveTo(-7, 0); // Back to tip
                ctx.lineTo(7, 9);  // Bottom right arm
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.shadowColor = "black";
                ctx.shadowBlur = 2;
                ctx.stroke();
            } else {
                // Diamond for GS/GP.
                ctx.beginPath();
                ctx.moveTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(0, 7); ctx.lineTo(-7, 0);
                ctx.closePath();

                if (isFilled) {
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = "#222"; // Add a dark border for contrast.
                    ctx.lineWidth = 2;
                    ctx.stroke();
                } else {
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
            ctx.restore();
        };

        // --- Draw Indicators (Preview first, then Active) ---
        // 1. Draw Preview VDI
        if (showPreview) {
            const isPreviewVnav = this.previewVtgType === "VNAV";

            // If VNAV is preview, draw in normal magenta; otherwise keep your preview color.
            const previewColor = isPreviewVnav
                ? "rgba(255, 0, 255, 0.5)"
                : "rgba(255, 255, 255, 0.7)";

            // VNAV preview uses the VNAV marker shape, others use the diamond.
            drawVdiMarker(this.previewVdiDeflection, previewColor, false, isPreviewVnav);
        }

        // 2. Draw Active VDI on top.
        if (showActive) {
            const activeColor = this.vtgType === 'GS' ? '#00ff00' : this.magenta;
            const isVnav = this.vtgType === 'VNAV';
            drawVdiMarker(this.vtgDeflection, activeColor, true, isVnav);
        }
    }

    followTRK() {
        if (this.trkHold) {
            let drift = this.heading - this.groundTrack; // positive if crab left, negative if right
            // Normalize to [-180,180] to handle wrap
            if (drift < -180) drift += 360;
            if (drift > 180) drift -= 360;
            // Heading bug should be set to (target track + drift)
            let commandedHeading = (this.trkSel + drift + 360) % 360;
            // Only update if bug differs enough (avoid jitter)
            if (Math.abs(this.hdgSel - commandedHeading) > 0.5) {
                SimVar.SetSimVarValue("K:HEADING_BUG_SET", "number", Math.round(commandedHeading));
            }
        }
    }

    drawTouchBoxes(ctx, drawAll = false) {
        // Indices 4..8 are your knob-related touchboxes:
        // 4 large_knob_cw, 5 large_knob_ccw, 6 small_knob_cw, 7 small_knob_ccw, 8 small_knob_button
        // (kept index-based to match your current array layout)
        for (let i = 0; i < this.touchBoxes.length; i++) {
            const isKnobBox = (i >= 4 && i <= 8);

            // When drawAll=false → draw only knob boxes
            // When drawAll=true  → draw everything
            if (!drawAll && !isKnobBox) continue;

            const box = this.touchBoxes[i];
            if (!box) continue;

            ctx.save();
            ctx.globalAlpha = 0.25;
            ctx.strokeStyle = "#29f";
            ctx.fillStyle = "rgba(80,180,255,0.3)";
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.rect(box.x, box.y, box.w, box.h);
            ctx.stroke();

            ctx.globalAlpha = 0.11;
            ctx.fill();
            ctx.restore();
        }
    }

    drawDebugText(ctx) {
        if (!ctx) return;

        const text = String(this.debugText || "");
        if (!text) return;

        ctx.save();
        ctx.font = "12px monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const x = 8, y = 8, pad = 4;
        const w = ctx.measureText(text).width + pad * 2;
        const h = 14 + pad * 2;

        ctx.globalAlpha = 0.75;
        ctx.fillStyle = "#000";
        ctx.fillRect(x, y, w, h);

        ctx.globalAlpha = 1.0;
        ctx.fillStyle = "#00ff00";
        ctx.fillText(text, x + pad, y + pad);

        ctx.restore();
    }

    drawRMIneedles(ctx, cx, cy, R) {
        const needleColor = "#26c6ff";
        let track;
        if (this.HdgTrk === 0) {
            track = this.heading;
        } else {
            track = this.trackMag;
        }

        const shaftLen = R * 0.95;
        const tailLen = R * 0.95;
        const shaftWidth = 1;
        const doubleSep = 8;

        // Squashed Arrowhead Dimensions
        const arrowLen = 10;  // Shorter length for "squashed" look
        const arrowWidth = 30; // Wider base

        // Bearing 1: Single Needle
        if (this.RMI1Source && isFinite(this.bearing1)) {
            const bearingRel = ((this.bearing1 - track + 360) % 360);
            const angleRad = (bearingRel - 90) * Math.PI / 180;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angleRad);

            // Shaft
            ctx.beginPath();
            ctx.moveTo(-tailLen, 0);
            ctx.lineTo(shaftLen - arrowLen, 0); // End where arrow begins
            ctx.lineWidth = shaftWidth;
            ctx.strokeStyle = needleColor;
            ctx.stroke();

            // Filled Squashed Arrowhead
            ctx.beginPath();
            ctx.moveTo(shaftLen, 0); // Tip
            ctx.lineTo(shaftLen - arrowLen, -arrowWidth / 2); // Top base
            ctx.lineTo(shaftLen - arrowLen, arrowWidth / 2);  // Bottom base
            ctx.closePath();
            ctx.fillStyle = needleColor;
            ctx.fill();

            ctx.restore();
        }

        // Bearing 2: Double Needle
        if (this.RMI2Source && isFinite(this.bearing2)) {
            const bearingRel = ((this.bearing2 - track + 360) % 360);
            const angleRad = (bearingRel - 90) * Math.PI / 180;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angleRad);

            // Double shaft
            ctx.beginPath();
            ctx.moveTo(-tailLen, -doubleSep / 2);
            ctx.lineTo(shaftLen - arrowLen, -doubleSep / 2);
            ctx.moveTo(-tailLen, +doubleSep / 2);
            ctx.lineTo(shaftLen - arrowLen, +doubleSep / 2);
            ctx.lineWidth = 2;
            ctx.strokeStyle = needleColor;
            ctx.stroke();

            // Filled Squashed Arrowhead (Single shared head)
            ctx.beginPath();
            ctx.moveTo(shaftLen, 0); // Tip
            ctx.lineTo(shaftLen - arrowLen, -arrowWidth / 2);
            ctx.lineTo(shaftLen - arrowLen, arrowWidth / 2);
            ctx.closePath();
            ctx.fillStyle = needleColor;
            ctx.fill();

            ctx.restore();
        }

        // Draw circle mask
        const img = this.images.circle;
        if (img && img.complete && img.naturalWidth > 0) {
            const circleSize = R * 1.34;
            ctx.save();
            ctx.drawImage(img, cx - circleSize / 2, cy - circleSize / 2, circleSize, circleSize);
            ctx.restore();
        }
    }


    drawRMISources(ctx, cx, cy, R) {
        // Box geometry
        const boxW = 40, boxH = 18;
        const boxColor = "#181818";
        const boxStroke = "#fff";
        const arrowColor = "#26c6ff";
        const arrowHeight = 10;
        const arrowX = 8;
        const arrowBaseY = 6;

        // --- Bearing 1 Source Box ---
        // Bearing 1: Only if RMI1Source is not none/0
        if (this.RMI1Source) {
            let bearing1SourceText = (this.RMI1Source === 1) ? "GPS" : "VOR1";

            const trkBoxX = cx - 57, trkBoxY = cy + 68;
            const bearing1BoxX = trkBoxX + boxW / 2 - 10;
            const bearing1BoxY = trkBoxY - boxH - 8 + 10;

            ctx.save();
            //ctx.beginPath();
            //ctx.rect(bearing1BoxX - boxW / 2, bearing1BoxY - boxH / 2, boxW, boxH);
            //ctx.fillStyle = boxColor;
            //ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = boxStroke;
            //ctx.stroke();
            this.drawRoundedRect(ctx, bearing1BoxX - boxW / 2, bearing1BoxY - boxH / 2, boxW, boxH, 4, boxColor);
            ctx.restore();

            // Arrow
            ctx.save();
            ctx.translate(
                bearing1BoxX - boxW / 2 + arrowX,
                bearing1BoxY + arrowBaseY
            );
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(0, -arrowHeight);
            ctx.lineWidth = 1;
            ctx.strokeStyle = arrowColor;
            ctx.stroke();
            // Arrow head (V)
            ctx.beginPath();
            ctx.moveTo(0, -arrowHeight);
            ctx.lineTo(-3, -arrowHeight + 4);
            ctx.moveTo(0, -arrowHeight);
            ctx.lineTo(+3, -arrowHeight + 4);
            ctx.lineWidth = 1;
            ctx.strokeStyle = arrowColor;
            ctx.stroke();
            ctx.restore();

            // Source label right of arrow
            ctx.font = "10px Arial";
            ctx.fillStyle = "#fff";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(bearing1SourceText, bearing1BoxX - boxW / 2 + 12, bearing1BoxY);

            ctx.restore();
        }

        // --- Bearing 2 Source Box ---
        // Bearing 2: Only if RMI2Source is not none/0
        if (this.RMI2Source) {
            let bearing2SourceText = (this.RMI2Source === 1) ? "GPS" : "VOR2";
            const crsBoxX = cx + 18, crsBoxY = cy + 53;
            const bearing2BoxX = crsBoxX + boxW / 2 + 16;
            const bearing2BoxY = crsBoxY - boxH - 8 + 27;

            ctx.save();
            //ctx.beginPath();
            //ctx.rect(bearing2BoxX - boxW / 2, bearing2BoxY - boxH / 2, boxW, boxH);
            //ctx.fillStyle = boxColor;
            //ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = boxStroke;
            //ctx.stroke();
            this.drawRoundedRect(ctx, bearing2BoxX - boxW / 2, bearing2BoxY - boxH / 2, boxW, boxH, 4, boxColor);
            ctx.restore();

            ctx.save();
            ctx.translate(
                bearing2BoxX - boxW / 2 + arrowX,
                bearing2BoxY + arrowBaseY
            );
            // Shaft 1
            ctx.beginPath();
            ctx.moveTo(-1, 0); ctx.lineTo(-1, -arrowHeight);
            ctx.lineWidth = 1;
            ctx.strokeStyle = arrowColor;
            ctx.stroke();
            // Shaft 2
            ctx.beginPath();
            ctx.moveTo(+1, 0); ctx.lineTo(+1, -arrowHeight);
            ctx.lineWidth = 1;
            ctx.strokeStyle = arrowColor;
            ctx.stroke();
            // Common arrow head (V)
            ctx.beginPath();
            ctx.moveTo(0, -arrowHeight);
            ctx.lineTo(-4, -arrowHeight + 7);
            ctx.moveTo(0, -arrowHeight);
            ctx.lineTo(+4, -arrowHeight + 7);
            ctx.lineWidth = 1;
            ctx.strokeStyle = arrowColor;
            ctx.stroke();
            ctx.restore();

            // Source label right of arrow
            ctx.font = "10px Arial";
            ctx.fillStyle = "#fff";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(bearing2SourceText, bearing2BoxX - boxW / 2 + 12, bearing2BoxY);

            ctx.restore();
        }
    }

    // Dispatch for the user-selectable "Misc. Field" overlay (Off/TAS/GS/OAT/Wind).
    drawMiscBox(ctx) {
        if (this.miscOption === -1) return;
        if (this.miscOption === 0) this.drawTASBox(ctx);
        else if (this.miscOption === 1) this.drawGSBox(ctx);
        else if (this.miscOption === 2) this.drawOATBox(ctx);
        else if (this.miscOption === 3) this.drawWindBox(ctx);
    }

    // Shared box renderer: black box with white border, a label, value, and unit.
    // Geometry matches the original TAS box so all Misc. Field options look consistent.
    // Shared box geometry for all Misc. Field overlays (keeps TAS/GS/OAT/Wind aligned).
    _miscBoxGeometry() {
        const canvasH = this.canvas.height;
        const tapeTop = canvasH - 180; // match vertical area used for TRK (same baseline)
        const boxW = 35;
        const boxH = 15;
        const boxX = 50;
        const boxY = tapeTop - boxH;
        return { boxX, boxY, boxW, boxH };
    }

    _drawMiscValueBox(ctx, label, valueText, unitText) {
        if (!ctx || !this.canvas) return;

        const { boxX, boxY, boxW, boxH } = this._miscBoxGeometry();

        ctx.save();
        ctx.fillStyle = "#000";
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        // Label (white) at top-left inside box
        ctx.font = "8px Arial";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(label, boxX + 13, boxY - 1);

        // Value (bigger) centered horizontally in the box, below label
        ctx.font = "10px Arial";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const numX = boxX + boxW / 2 - 10; // leave room for the unit to the right
        const numY = boxY + (boxH / 2) + 4;
        ctx.fillText(valueText, numX, numY);

        // Unit label small to the right of the number
        ctx.font = "8px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(unitText, numX + 10, numY + 2);

        ctx.restore();
    }

    // Draw TAS box: black box with white border, "TAS" label, TAS value and "MPH"
    drawTASBox(ctx) {
        const valText =
            (typeof this.tasMph === "number" && isFinite(this.tasMph) && this.tasMph !== 0)
                ? String(this.tasMph)
                : "--";
        this._drawMiscValueBox(ctx, "TAS", valText, "MPH");
    }

    // Draw GS box: same style as TAS, but ground speed (MPH)
    drawGSBox(ctx) {
        const valText =
            (typeof this.gsMph === "number" && isFinite(this.gsMph) && this.gsMph !== 0)
                ? String(this.gsMph)
                : "--";
        this._drawMiscValueBox(ctx, "GS", valText, "MPH");
    }

    // Draw OAT box: same style as TAS, outside air temperature (Celsius)
    drawOATBox(ctx) {
        const valText =
            (typeof this.oatC === "number" && isFinite(this.oatC) && this.oatC !== 0)
                ? String(this.oatC)
                : "--";
        this._drawMiscValueBox(ctx, "OAT", valText, "C");
    }

    // Draw Wind box: black box, styled per this.windOption (set via "Wind Settings"):
    //   0: "<-MPH ^MPH" crosswind/headwind components
    //   1: "DEG MPH" wind direction (magnetic) over speed
    //   2: rotated arrow (relative wind) + speed
    // Draws a small directional arrow (shaft + arrowhead) centered at (cx, cy),
    // rotated by angleRad. angleRad=0 points down, Math.PI/2 points left,
    // -Math.PI/2 points right, Math.PI points up. Used instead of Unicode arrow
    // glyphs (←→↑↓), which render as placeholder boxes in the sim's text renderer.
    _drawWindArrowGlyph(ctx, cx, cy, angleRad, len) {
        const half = len / 2;
        const headLen = len * 0.45;
        const headHalf = len * 0.35;

        ctx.save();
        ctx.lineWidth = 1.2;
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);

        ctx.beginPath();
        ctx.moveTo(0, -half);
        ctx.lineTo(0, half);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, half);
        ctx.lineTo(-headHalf, half - headLen);
        ctx.moveTo(0, half);
        ctx.lineTo(headHalf, half - headLen);
        ctx.stroke();
        ctx.restore();
    }

    // Draws a small ring to represent a degree mark, since the "°" glyph does not
    // render in the sim's text renderer (mirrors PFD's drawDegreeSymbol).
    drawDegreeSymbol(ctx, x, y, radius = 3) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.85;
        ctx.stroke();
        ctx.restore();
    }

    drawWindBox(ctx) {
        if (!ctx || !this.canvas) return;
        if (this.isOnGround) return; // on the ground, no display

        const { boxX, boxY, boxW, boxH } = this._miscBoxGeometry();
        const textColor = "#fff";

        // Wind relative to heading (mirrors PFD drawWind)
        const windTrue = this.windDirection;              // AMBIENT WIND DIRECTION (true)
        const hdgMag = this.heading;                       // PLANE HEADING DEGREES MAGNETIC
        const magVar = this.magVar || 0;                    // MAGVAR (+East)
        const windMag = ((windTrue - magVar) % 360 + 360) % 360;
        const relativeDeg = ((windMag - hdgMag) % 360 + 360) % 360;
        const rad = relativeDeg * Math.PI / 180;

        const cx = boxX + boxW / 2;
        const cy = boxY + boxH / 2;

        // Calm wind: show "WIND" over "CALM"
        if (!this.windSpeed || Math.round(this.windSpeed) === 0) {
            ctx.save();
            ctx.fillStyle = "#000";
            ctx.fillRect(boxX, boxY, boxW, boxH);
            ctx.strokeStyle = textColor;
            ctx.strokeRect(boxX, boxY, boxW, boxH);
            ctx.fillStyle = textColor;
            ctx.font = "8px MSFS_LABEL";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("WIND", cx, cy - 4);
            ctx.fillText("CALM", cx, cy + 5);
            ctx.restore();
            return;
        }

        ctx.save();
        ctx.fillStyle = "#000";
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);
        ctx.fillStyle = textColor;
        ctx.strokeStyle = textColor;

        if (this.windOption === 0) {
            // "<-MPH ^MPH": crosswind and headwind components.
            // Arrows are drawn manually (canvas paths) rather than with Unicode glyphs,
            // since the sim's text renderer shows a placeholder box for arrow characters.
            ctx.font = "8px MSFS_LABEL";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";

            const hdgComp = Math.cos(rad) * this.windSpeed;
            const crsComp = Math.sin(rad) * this.windSpeed;

            // angle=0 draws downward, Math.PI/2 draws left, -Math.PI/2 draws right, Math.PI draws up.
            const crsArrowAngle = crsComp > 0 ? Math.PI / 2 : -Math.PI / 2;
            const hdgArrowAngle = hdgComp >= 0 ? Math.PI : 0;

            this._drawWindArrowGlyph(ctx, boxX + 6, cy - 4, crsArrowAngle, 6);
            this._drawWindArrowGlyph(ctx, boxX + 6, cy + 5, hdgArrowAngle, 6);

            ctx.fillText(String(Math.round(Math.abs(crsComp))), boxX + 10, cy - 4);
            ctx.fillText(String(Math.round(Math.abs(hdgComp))), boxX + 10, cy + 5);

        } else if (this.windOption === 1) {
            // "DEG MPH": direction over speed.
            // The degree mark is drawn manually (small ring) via drawDegreeSymbol,
            // since the "°" glyph does not render in the sim's text renderer.
            ctx.font = "8px MSFS_LABEL";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const dirStr = Math.round(windMag).toString().padStart(3, "0");
            const spdStr = Math.round(this.windSpeed).toString();

            ctx.fillText(dirStr, cx, cy - 4);
            const dirMetrics = ctx.measureText(dirStr);
            const degX = cx + (dirMetrics.width / 2) + 3;
            const degY = cy - 6;
            this.drawDegreeSymbol(ctx, degX, degY, 1.2);

            ctx.fillText(spdStr, cx, cy + 5);

        } else {
            // Rotated arrow (relative wind direction) + speed
            const shaftLen = 8;
            const halfShaft = shaftLen / 2;
            const headLen = 3;
            const headHalf = 2;

            ctx.lineWidth = 1.2;
            ctx.save();
            ctx.translate(boxX + 10, cy);
            ctx.rotate(rad);

            ctx.beginPath();
            ctx.moveTo(0, -halfShaft);
            ctx.lineTo(0, halfShaft);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(0, halfShaft);
            ctx.lineTo(-headHalf, halfShaft - headLen);
            ctx.moveTo(0, halfShaft);
            ctx.lineTo(headHalf, halfShaft - headLen);
            ctx.stroke();
            ctx.restore();

            ctx.font = "8px MSFS_LABEL";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(Math.round(this.windSpeed) + " KT", boxX + 16, cy);
        }

        ctx.restore();
    }


    // Helper: convert lat/lon to pixel offsets relative to the aircraft and map scale.
    // Returns offsets from the center (NOT absolute canvas coordinates) to use after ctx.translate(cx, cy).
    // Fix scale in LatLongToXY to honor mapRange as RADIUS in NM
    LatLongToXY(lat, lon, R, mapRange, centerLat, centerLon) {
        const degToRad = Math.PI / 180;
        const nmPerDegLat = 60;
        const nmPerDegLon = nmPerDegLat * Math.cos(centerLat * degToRad);

        const dxNM = (lon - centerLon) * nmPerDegLon;  // East-West → X
        const dyNM = (lat - centerLat) * nmPerDegLat;  // North-South → Y

        // If mapRange is the RADIUS in NM, 1 NM equals R / mapRange pixels
        const pixelsPerNM = R / mapRange;

        const x = dxNM * pixelsPerNM;
        const y = -dyNM * pixelsPerNM;

        return { x, y };
    }

    // Helper: initial great-circle bearing from (lat1,lon1) to (lat2,lon2) in degrees [0..360)
    initialBearingDeg(lat1, lon1, lat2, lon2) {
        const toRad = Math.PI / 180;
        const toDeg = 180 / Math.PI;

        const phi1 = lat1 * toRad;
        const phi2 = lat2 * toRad;
        const deltaLambda = (lon2 - lon1) * toRad;

        const y = Math.sin(deltaLambda) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
        let theta = Math.atan2(y, x) * toDeg; // -180..+180
        theta = (theta % 360 + 360) % 360;    // normalize to 0..360
        return theta;
    }

    // Find a waypoint in this.flightPlanWaypoints by ident/name.
    // Returns: { id, lat, lon, index } or null.
    //
    // Options:
    // - caseInsensitive: match ignoring case (default true)
    // - allowPrefixRW: optionally normalize "RW31" vs "RW31 " (default false; you can extend)
    // - latLonTolerance: if provided, can fallback-match by lat/lon within tolerance (degrees)
    findWaypointInFlightPlan(ident, opts = {}) {
        const {
            caseInsensitive = true,
            latLon = null,              // optional: { lat, lon } to fallback match
            latLonTolerance = 0.0001    // ~30 ft
        } = opts;

        if (!Array.isArray(this.flightPlanWaypoints) || this.flightPlanWaypoints.length === 0) {
            return null;
        }

        const needleRaw = String(ident || "").trim();
        const needle = caseInsensitive ? needleRaw.toUpperCase() : needleRaw;

        // 1) Primary: match by name/ident (SEARCH FROM END so duplicates pick the later one)
        if (needle) {
            for (let i = this.flightPlanWaypoints.length - 1; i >= 0; i--) {
                const wp = this.flightPlanWaypoints[i];
                if (!wp) continue;

                const nameRaw = String(wp.name || "").trim();
                const name = caseInsensitive ? nameRaw.toUpperCase() : nameRaw;

                if (name && name === needle) {
                    if (Number.isFinite(wp.lat) && Number.isFinite(wp.lon)) {
                        return { id: nameRaw, lat: wp.lat, lon: wp.lon, index: i };
                    }
                }
            }
        }

        // 2) Optional fallback: match by lat/lon if provided
        if (latLon && Number.isFinite(latLon.lat) && Number.isFinite(latLon.lon)) {
            let best = null;
            let bestScore = Infinity;

            for (let i = 0; i < this.flightPlanWaypoints.length; i++) {
                const wp = this.flightPlanWaypoints[i];
                if (!wp) continue;
                if (!Number.isFinite(wp.lat) || !Number.isFinite(wp.lon)) continue;

                const dLat = Math.abs(wp.lat - latLon.lat);
                const dLon = Math.abs(wp.lon - latLon.lon);

                if (dLat <= latLonTolerance && dLon <= latLonTolerance) {
                    const score = dLat + dLon;
                    if (score < bestScore) {
                        bestScore = score;
                        best = { id: String(wp.name || ""), lat: wp.lat, lon: wp.lon, index: i };
                    }
                }
            }

            if (best) return best;
        }

        return null;
    }

    resolveActiveWaypointByIdent(ident) {
        const needle = String(ident || "").trim();
        if (!needle) return null;

        // Prefer approach waypoints when on approach/missed approach
        const apprMode = (typeof SimVar !== "undefined" && typeof SimVar.GetSimVarValue === "function")
            ? (Number(SimVar.GetSimVarValue("GPS APPROACH MODE", "Number")) || 0)
            : 0;

        const preferApproach = (apprMode >= 1) || (Number(this.phaseIdx) === 14 || Number(this.phaseIdx) === 15);

        const tryFind = (list) => {
            if (!Array.isArray(list)) return null;
            const up = needle.toUpperCase();
            for (let i = list.length - 1; i >= 0; i--) {
                const wp = list[i];
                if (!wp) continue;
                const n = String(wp.name || "").trim().toUpperCase();
                if (n === up && Number.isFinite(wp.lat) && Number.isFinite(wp.lon)) {
                    return { name: wp.name, lat: wp.lat, lon: wp.lon };
                }
            }
            return null;
        };

        let found = null;
        if (preferApproach) {
            found = tryFind(this.approachWaypoints) || tryFind(this.flightPlanWaypoints);
        } else {
            found = tryFind(this.flightPlanWaypoints) || tryFind(this.approachWaypoints);
        }

        return found;
    }

    drawActiveWaypointOnly(ctx, cx, cy, R) {
        const nextIdent = (typeof SimVar !== "undefined")
            ? (SimVar.GetSimVarValue("GPS WP NEXT ID", "string") || "")
            : "";

        const active = this.resolveActiveWaypointByIdent(nextIdent);

        // Fallback to simvar lat/lon only if not found in plans
        let activeLat = active ? active.lat : NaN;
        let activeLon = active ? active.lon : NaN;

        if (!Number.isFinite(activeLat) || !Number.isFinite(activeLon)) {
            activeLat = Number(SimVar.GetSimVarValue("GPS WP NEXT LAT", "degrees"));
            activeLon = Number(SimVar.GetSimVarValue("GPS WP NEXT LON", "degrees"));
            if (Math.abs(activeLat) <= 3.2 && Math.abs(activeLon) <= 3.2) {
                activeLat = activeLat * 180 / Math.PI;
                activeLon = activeLon * 180 / Math.PI;
            }
        }

        if (!Number.isFinite(activeLat) || !Number.isFinite(activeLon)) return;

        // Choose map track mode same as your existing logic
        let track = (this.HdgTrk === 0) ? this.trueHeading : this.trackTrue;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((-track * Math.PI) / 180);

        const p = this.LatLongToXY(activeLat, activeLon, R * this.mapScaleTweak, this.visibleMapRange, this.airplaneLat, this.airplaneLon);
        if (!p) { ctx.restore(); return; }

        // Draw course line using DTK (magenta)
        if (Number.isFinite(this.dtkDeg)) {
            const courseToWP = (this.dtkDeg + (this.magVar || 0) + 360) % 360;
            const angleRad = (courseToWP * Math.PI) / 180;
            const dirX = Math.sin(angleRad);
            const dirY = -Math.cos(angleRad);

            const lineLength = 1000;
            ctx.beginPath();
            ctx.moveTo(p.x - dirX * lineLength, p.y - dirY * lineLength);
            ctx.lineTo(p.x, p.y);
            ctx.strokeStyle = this.magenta;
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        // Active magenta diamond
        ctx.fillStyle = this.magenta;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 6);
        ctx.lineTo(p.x + 6, p.y);
        ctx.lineTo(p.x, p.y + 6);
        ctx.lineTo(p.x - 6, p.y);
        ctx.closePath();
        ctx.fill();

        const label = (active && active.name) ? active.name : String(nextIdent || "").trim();
        this.drawWaypointLabel(ctx, p, label, this.magenta, track);

        ctx.restore();
    }

    drawWaypoints(ctx, cx, cy, R) {

        R = R * this.mapScaleTweak; // tweak scale

        let track;
        if (this.HdgTrk === 0) {
            track = this.trueHeading;
        } else {
            track = this.trackTrue;
        }

        // --- Choose which plan to draw ---
        let approachActive = false;
        if (typeof SimVar !== "undefined" && typeof SimVar.GetSimVarValue === "function") {
            const apprMode = Number(SimVar.GetSimVarValue("GPS APPROACH MODE", "Number")) || 0;
            approachActive = (apprMode === 1 || apprMode === 2);
        }

        // missed approach, just draw the active waypoint
        const isMissed = (Number(this.phaseIdx) === 14 || Number(this.phaseIdx) === 15);
        if (isMissed) {
            this.drawActiveWaypointOnly(ctx, cx, cy, R);
            return;
        }

        const rawPlan = approachActive ? (this.approachWaypoints || []) : (this.flightPlanWaypoints || []);

        // Active/prev waypoint idents (strings)
        const nextWPident = (typeof SimVar !== "undefined")
            ? (SimVar.GetSimVarValue("GPS WP NEXT ID", "string") || "")
            : "";

        const prevWPident = (typeof SimVar !== "undefined")
            ? (SimVar.GetSimVarValue("GPS WP PREV ID", "string") || "")
            : "";

        // If you still want to keep your sync L:Var for debugging
        try {
            if (typeof SimVar !== "undefined") {
                this.syncActiveWaypointFromSim();
                SimVar.SetSimVarValue("L:MFD_active_wp_index", "number", this.activeWaypointIndex);
            }
        } catch (e) { }

        // --- Guards ---
        if (!ctx) return;
        if (!Array.isArray(rawPlan) || rawPlan.length === 0) return;
        if (!Number.isFinite(this.visibleMapRange) || this.visibleMapRange <= 0) return;
        if (!Number.isFinite(this.airplaneLat) || !Number.isFinite(this.airplaneLon)) return;

        const simNextIdent = (nextWPident || "").trim();
        const simPrevIdent = (prevWPident || "").trim();

        // ---- Helpers ----
        const isUserWp = (wp) => {
            const n = String(wp && wp.name || "").trim().toUpperCase();
            return n === "USER";
        };

        // Find waypoint in an arbitrary list by ident/name (search from END to prefer later duplicates)
        const findInListByIdent = (list, ident) => {
            if (!Array.isArray(list) || !ident) return null;
            const needle = String(ident).trim().toUpperCase();
            for (let i = list.length - 1; i >= 0; i--) {
                const wp = list[i];
                if (!wp) continue;
                const n = String(wp.name || "").trim().toUpperCase();
                if (n && n === needle) {
                    if (Number.isFinite(wp.lat) && Number.isFinite(wp.lon)) {
                        return { id: wp.name, lat: wp.lat, lon: wp.lon, index: i };
                    }
                }
            }
            return null;
        };

        // Build the plan we will actually DRAW.
        // Key fix: when approachActive, remove USER discontinuity points so we don't draw spurious legs.
        const plan = approachActive ? rawPlan.filter(wp => wp && !isUserWp(wp)) : rawPlan;

        if (!Array.isArray(plan) || plan.length === 0) return;

        // Simvar-provided NEXT WP coords (fallback only if NEXT ident not found in plan)
        let simLat = NaN, simLon = NaN;
        if (typeof SimVar !== "undefined" && typeof SimVar.GetSimVarValue === "function") {
            simLat = Number(SimVar.GetSimVarValue("GPS WP NEXT LAT", "degrees"));
            simLon = Number(SimVar.GetSimVarValue("GPS WP NEXT LON", "degrees"));

            // If radians slip through, convert
            if (Math.abs(simLat) <= 3.2 && Math.abs(simLon) <= 3.2) {
                simLat = simLat * 180 / Math.PI;
                simLon = simLon * 180 / Math.PI;
            }
        }
        const simHasLatLon = Number.isFinite(simLat) && Number.isFinite(simLon);

        // ---- Decide where to START drawing ----
        // Rule:
        // - When approachActive:
        //    - Use PREV if it is found AND not "USER" (in the RAW approach list)
        //    - Otherwise start from NEXT (in the DRAW plan, which has USER filtered out)
        //    - Otherwise draw whole approach (start at 0)
        let startIdx = 0;

        if (approachActive) {
            const prevLooksInvalid = !simPrevIdent || simPrevIdent.toUpperCase() === "USER";

            let prevInRawApproach = null;
            if (!prevLooksInvalid) {
                prevInRawApproach = findInListByIdent(rawPlan, simPrevIdent);
            }

            if (prevInRawApproach) {
                // If we start from PREV, we need its index in the FILTERED plan, not rawPlan.
                const prevInFiltered = findInListByIdent(plan, simPrevIdent);
                if (prevInFiltered && Number.isFinite(prevInFiltered.index) && prevInFiltered.index >= 0) {
                    startIdx = prevInFiltered.index;
                } else {
                    startIdx = 0;
                }
            } else {
                const nextInFiltered = findInListByIdent(plan, simNextIdent);
                if (nextInFiltered && Number.isFinite(nextInFiltered.index) && nextInFiltered.index >= 0) {
                    startIdx = nextInFiltered.index;
                } else {
                    startIdx = 0;
                }
            }
        }

        startIdx = Math.max(0, Math.min(startIdx, plan.length - 1));

        // ---- Decide ACTIVE waypoint position (lat/lon) ----
        let activeLat = NaN, activeLon = NaN;

        const activeFromPlan = findInListByIdent(plan, simNextIdent);

        if (activeFromPlan) {
            activeLat = activeFromPlan.lat;
            activeLon = activeFromPlan.lon;
        } else if (simHasLatLon) {
            activeLat = simLat;
            activeLon = simLon;
        }

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((-track * Math.PI) / 180);

        // Build offsets for waypoints (skip invalid)
        const offsets = plan.slice(startIdx).map((wp) => {
            if (!wp || !Number.isFinite(wp.lat) || !Number.isFinite(wp.lon)) return null;
            return this.LatLongToXY(wp.lat, wp.lon, R, this.visibleMapRange, this.airplaneLat, this.airplaneLon);
        });

        // Route lines (cyan)
        for (let i = 0; i < offsets.length - 1; i++) {
            const a = offsets[i];
            const b = offsets[i + 1];
            if (!a || !b) continue;

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = this.lightBlue;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 1.0;
            ctx.stroke();
        }

        // Active waypoint offset
        let activeOffset = null;
        if (Number.isFinite(activeLat) && Number.isFinite(activeLon)) {
            activeOffset = this.LatLongToXY(activeLat, activeLon, R, this.visibleMapRange, this.airplaneLat, this.airplaneLon);
        } else if (offsets[0]) {
            activeOffset = offsets[0];
        }

        // Diamonds for all waypoints (cyan)
        for (let i = 0; i < offsets.length; i++) {
            const p = offsets[i];
            if (!p) continue;

            ctx.fillStyle = this.lightBlue;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y - 5);
            ctx.lineTo(p.x + 5, p.y);
            ctx.lineTo(p.x, p.y + 5);
            ctx.lineTo(p.x - 5, p.y);
            ctx.closePath();
            ctx.fill();
        }

        // Labels (cyan)
        for (let i = 0; i < offsets.length; i++) {
            const p = offsets[i];
            if (!p) continue;

            const wpIdx = startIdx + i;
            const name = plan[wpIdx] && plan[wpIdx].name ? String(plan[wpIdx].name) : "";
            if (!name) continue;

            const offsetX = 10, offsetY = -8, fontSpec = "10px Arial", padX = 4, rectH = 12;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(track * Math.PI / 180);
            ctx.font = fontSpec;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            const textWidth = ctx.measureText(name).width;
            const rectW = Math.max(12, textWidth + padX * 2);
            const rectX = offsetX, rectY = offsetY - rectH / 2;
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = "#000";
            ctx.fillRect(rectX, rectY, rectW, rectH);
            ctx.globalAlpha = 1.0;
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = this.lightBlue;
            ctx.strokeRect(rectX, rectY, rectW, rectH);
            ctx.fillStyle = this.lightBlue;
            ctx.fillText(name, rectX + padX, rectY + rectH / 2);
            ctx.restore();
        }

        // Magenta course line to the active waypoint (DTK) + active marker
        if (activeOffset && Number.isFinite(this.dtkDeg)) {
            const courseToWP = (this.dtkDeg + (this.magVar || 0) + 360) % 360;
            try { if (typeof SimVar !== "undefined") SimVar.SetSimVarValue("L:MFD_active_wp_dtk", "number", courseToWP); } catch (e) { }

            const angleRad = (courseToWP * Math.PI) / 180;
            const dirX = Math.sin(angleRad);
            const dirY = -Math.cos(angleRad);

            const lineLength = 1000;

            ctx.beginPath();
            ctx.moveTo(
                activeOffset.x - (dirX * lineLength),
                activeOffset.y - (dirY * lineLength)
            );
            ctx.lineTo(activeOffset.x, activeOffset.y);

            ctx.strokeStyle = this.magenta;
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        // Magenta diamond + label at active waypoint
        if (activeOffset) {
            ctx.fillStyle = this.magenta;
            ctx.beginPath();
            ctx.moveTo(activeOffset.x, activeOffset.y - 6);
            ctx.lineTo(activeOffset.x + 6, activeOffset.y);
            ctx.lineTo(activeOffset.x, activeOffset.y + 6);
            ctx.lineTo(activeOffset.x - 6, activeOffset.y);
            ctx.closePath();
            ctx.fill();

            const activeLabel =
                simNextIdent ||
                (activeFromPlan && activeFromPlan.id) ||
                "";

            this.drawWaypointLabel(ctx, activeOffset, activeLabel, this.magenta, track);
        }

        ctx.restore();
    }

    // Helper method to draw labels with a black background and colored border/text
    drawWaypointLabel(ctx, p, name, color, trackMag) {
        if (!name || name.toUpperCase() === "USER") return;

        const offsetX = 10, offsetY = -8, fontSpec = "10px Arial", padX = 4, rectH = 12;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(trackMag * Math.PI / 180); // Keep text upright relative to screen

        ctx.font = fontSpec;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const textWidth = ctx.measureText(name).width;
        const rectW = Math.max(12, textWidth + padX * 2);
        const rectX = offsetX, rectY = offsetY - rectH / 2;

        // Black Background Fill
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#000";
        ctx.fillRect(rectX, rectY, rectW, rectH);

        // Light Blue Border
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color; // e.g., this.lightBlue or this.magenta
        ctx.strokeRect(rectX, rectY, rectW, rectH);

        // Light Blue Text
        ctx.fillStyle = color;
        ctx.fillText(name, rectX + padX, rectY + rectH / 2);

        ctx.restore();
    }


    // Helper: rounded rectangle
    drawRoundedRect(ctx, x, y, w, h, r, fillColor = null) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;

        ctx.beginPath();
        ctx.moveTo(x + r, y);
        // Top side and top-right corner
        ctx.arcTo(x + w, y, x + w, y + h, r);
        // Right side and bottom-right corner
        ctx.arcTo(x + w, y + h, x, y + h, r);
        // Bottom side and bottom-left corner
        ctx.arcTo(x, y + h, x, y, r);
        // Left side and top-left corner
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();

        // Fill logic: only fills if a color is provided
        if (fillColor) {
            ctx.fillStyle = fillColor;
            ctx.fill();
        }

        ctx.stroke(); // Always draws the border
    }


    // Map Range box: aligned to the 'map_range' touchbox
    // Replace your existing drawMapRangeBox(ctx) with this version
    drawMapRangeBox(ctx) {
        if (!this.canvas || !ctx) return;

        // Only draw on the map page (remove this guard if you want it on both pages)
        if (this.currentPage !== "map") return;

        // Use the touchbox geometry
        const box = this.touchBoxes && this.touchBoxes.find(b => b.id === "map_range");
        if (!box) return;

        // Clamp and format range
        const rangeNm = Math.max(0, Math.min(500, Math.round(this.mapRange)));
        // Logic for dynamic Feet vs NM labels
        let label = "";
        if (this.mapRange <= 0.1) {
            // Convert mapRange to Feet (0.01 -> 500FT, 0.1 -> 5000FT)
            // 0.01 * 50000 = 500
            const rangeFt = Math.round(this.mapRange * 50000);
            label = `${rangeFt}FT`;
        } else {
            // Standard NM formatting
            const rangeNm = Math.max(0, Math.min(500, Math.round(this.mapRange)));
            label = `${rangeNm}NM`;
        }

        const isActive = this.activeBox === "map_range";

        // Spec:
        // - Black background
        // - Border: white when not selected, light blue when selected
        // - Text: always white
        const fillColor = "#000000";
        const borderColor = isActive ? this.lightBlue : "#ffffff";
        const textColor = "#ffffff";

        // Rounded rectangle
        const r = 6;
        ctx.save();

        // Path
        ctx.beginPath();
        ctx.moveTo(box.x + r, box.y);
        ctx.lineTo(box.x + box.w - r, box.y);
        ctx.quadraticCurveTo(box.x + box.w, box.y, box.x + box.w, box.y + r);
        ctx.lineTo(box.x + box.w, box.y + box.h - r);
        ctx.quadraticCurveTo(box.x + box.w, box.y + box.h, box.x + box.w - r, box.y + box.h);
        ctx.lineTo(box.x + r, box.y + box.h);
        ctx.quadraticCurveTo(box.x, box.y + box.h, box.x, box.y + box.h - r);
        ctx.lineTo(box.x, box.y + r);
        ctx.quadraticCurveTo(box.x, box.y, box.x + r, box.y);
        ctx.closePath();

        // Fill and stroke
        ctx.fillStyle = fillColor;
        ctx.globalAlpha = 1.0;
        ctx.fill();

        ctx.lineWidth = 2.5;
        ctx.strokeStyle = borderColor;
        ctx.stroke();

        // Text
        ctx.font = "bold 14px Arial";
        ctx.fillStyle = textColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.fillText(label, box.x + box.w / 2, box.y + box.h / 2 + 1);

        ctx.restore();
    }

    // Replace drawPagingDots so it respects the visibility flag
    drawPagingDots(ctx) {
        if (!ctx || !this.canvas) return;

        // Only draw when visible and there are multiple pages
        if (!this.pageDotsVisible) return;
        if (this.pages.length <= 1) return;

        const canvasW = this.canvas.width;
        const dotRadius = 4;
        const dotSpacing = 14;
        const topMargin = 40;

        const totalWidth = (this.pages.length - 1) * dotSpacing;
        const startX = (canvasW - totalWidth) / 2;
        const currentIndex = this.getCurrentPageIndex();

        ctx.save();
        ctx.fillStyle = "#ffffff";
        for (let i = 0; i < this.pages.length; i++) {
            const x = startX + i * dotSpacing;
            const y = topMargin;
            ctx.beginPath();
            ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
            ctx.globalAlpha = (i === currentIndex) ? 1.0 : 0.3;
            ctx.fill();
        }
        ctx.restore();
    }

    // Updated drawMapCDI: move nav/phase outward 10px, filled triangle, add vertical centerline in CDI
    drawMapCDI(ctx, cx, cy, R) {
        if (!ctx) return;

        const toFromFlag = Math.round(this.toFromFlag);

        // Geometry
        const barW = Math.round(R * 1.65);
        const extraHeight = 10; // extend lower to fully cover compass rose
        const barH = Math.max(34, Math.round(R * 0.24)) + extraHeight;
        const barX = Math.round(cx - barW / 2);
        const barY = Math.round(cy + R - barH - 0);

        // Background (rounded rect)
        ctx.save();
        const r = 8;
        ctx.beginPath();
        ctx.moveTo(barX + r, barY);
        ctx.lineTo(barX + barW - r, barY);
        ctx.quadraticCurveTo(barX + barW, barY, barX + barW, barY + r);
        ctx.lineTo(barX + barW, barY + barH - r);
        ctx.quadraticCurveTo(barX + barW, barY + barH, barX + barW - r, barY + barH);
        ctx.lineTo(barX + r, barY + barH);
        ctx.quadraticCurveTo(barX, barY + barH, barX, barY + barH - r);
        ctx.lineTo(barX, barY + r);
        ctx.quadraticCurveTo(barX, barY, barX + r, barY);
        ctx.closePath();

        ctx.fillStyle = "#000";
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.stroke();

        // Vertical separators (dim white)
        const oneThird = (barW / 3);
        const xOffset = -10;
        ctx.beginPath();
        ctx.moveTo(barX + oneThird + xOffset, barY + 4);
        ctx.lineTo(barX + oneThird + xOffset, barY + barH - 4);
        ctx.moveTo((20 + barX + 2 * (oneThird)) + xOffset, barY + 4);
        ctx.lineTo((20 + barX + 2 * (oneThird)) + xOffset, barY + barH - 4);
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Colors
        const isGPS = (this.selectedNavSource === "GPS") || (this.navSourceText === "GPS");
        const sourceColor = isGPS ? (this.identColor || "#ff00ff") : "#00ff00";

        // Left: Nav source (move outward 10px → from 50 to 40)
        const navText = this.navSourceText || this.selectedNavSource || "";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = sourceColor;
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.fillText(navText, barX + 35, barY + 7);

        // Right: Flight phase (move outward 10px → from barW-50 to barW-40)
        const phase = this.phaseText || "";
        ctx.textAlign = "right";
        ctx.fillStyle = sourceColor;
        ctx.fillText(phase, barX + barW - 30, barY + 7);

        // Middle: Horizontal CDI
        const midX = Math.round(barX + oneThird + oneThird / 2);
        const baseY = Math.round(barY + barH - 12);

        // Make CDI ~10% wider and circles half size
        const cdiWidthScale = 1.1;
        const cdiMaxDots = 2;
        const dotSpacing = Math.round(16 * cdiWidthScale); // spread out more
        const dotRadius = 3; // half the previous size

        // Center vertical line (on-course marker), same off-white as circles
        ctx.beginPath();
        ctx.moveTo(midX, baseY - 16);
        ctx.lineTo(midX, baseY + 2);
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Empty circles (-2, -1, +1, +2)
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        const yDotAdj = -10;

        for (let i = -cdiMaxDots; i <= cdiMaxDots; i++) {
            if (i === 0) continue;
            const x = midX + i * dotSpacing;
            ctx.beginPath();
            ctx.arc(x, baseY + yDotAdj, dotRadius, 0, Math.PI * 2);
            ctx.stroke();
        }

        const triBaseW = 20;
        const triH = 20;
        let yAdjust = 0; // tweak the triangle

        // --- PREVIEW CDI (HOLLOW TRIANGLE) ---
        if (this.isPreviewActive) {
            const previewRaw = this.previewCdiDeflection;
            const previewNormDots = Math.max(-127, Math.min(127, previewRaw)) / 127 * cdiMaxDots;
            const previewTriX = Math.round(midX + previewNormDots * dotSpacing);
            const previewToFrom = this.previewToFrom;

            ctx.beginPath();
            if (previewToFrom === 2) {
                // Downward-facing (FROM)
                yAdjust = -triH;
                ctx.moveTo(previewTriX, baseY + triH + yAdjust);
                ctx.lineTo(previewTriX - triBaseW / 2, baseY + yAdjust);
                ctx.lineTo(previewTriX + triBaseW / 2, baseY + yAdjust);
            } else {
                // Upward-facing (TO or OFF)
                yAdjust = 0;
                ctx.moveTo(previewTriX, baseY - triH + yAdjust);
                ctx.lineTo(previewTriX - triBaseW / 2, baseY + yAdjust);
                ctx.lineTo(previewTriX + triBaseW / 2, baseY + yAdjust);
            }
            ctx.closePath();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.6; // Ghosted appearance
            ctx.stroke();
            ctx.globalAlpha = 1.0; // Reset alpha
        }

        // --- ACTIVE CDI (FILLED TRIANGLE) ---
        const raw = Number.isFinite(this.cdiDeflection) ? this.cdiDeflection : 0; // -127..127
        const normDots = Math.max(-127, Math.min(127, raw)) / 127 * cdiMaxDots;   // -2..+2
        const triX = Math.round(midX + normDots * dotSpacing);

        ctx.beginPath();
        if (toFromFlag === 2) {
            // Downward-facing (FROM)
            yAdjust = -triH;
            ctx.moveTo(triX, baseY + triH + yAdjust);                 // tip (down)
            ctx.lineTo(triX - triBaseW / 2, baseY + yAdjust);         // left base
            ctx.lineTo(triX + triBaseW / 2, baseY + yAdjust);         // right base
        } else {
            // Upward-facing (TO or OFF)
            yAdjust = 0;
            ctx.moveTo(triX, baseY - triH + yAdjust);                 // tip (up)
            ctx.lineTo(triX - triBaseW / 2, baseY + yAdjust);         // left base
            ctx.lineTo(triX + triBaseW / 2, baseY + yAdjust);         // right base
        }
        ctx.closePath();
        ctx.fillStyle = sourceColor;                     // filled triangle
        ctx.fill();                                      // fill only (no wireframe stroke)

        ctx.restore();
    }

    // Terrain functions
    terrainInit() {
        try {
            let mapElement = document.getElementById("MapContainer");
            if (mapElement) {
                this.map = new MapInstrument();
                this.map.init(mapElement);

                // Set the LVar to confirm success
                SimVar.SetSimVarValue("L:MyMapInitialized", "number", 1);
                console.log("Map initialized and LVar set.");
            } else {
                // Set to 0 if the container wasn't found
                SimVar.SetSimVarValue("L:MyMapInitialized", "number", 0);
            }
        } catch (e) {
            console.error("Map failed:", e);
            SimVar.SetSimVarValue("L:MyMapInitialized", "number", -1); // Error state
        }
    }

    drawMapCourseNeedle(ctx, cx, cy, R) {
        const course = Number(this.courseToDraw) || 0;
        let track;
        if (this.HdgTrk === 0) {
            track = this.heading;
        } else {
            track = this.trackMag;
        }
        const angleRad = (course - track) * Math.PI / 180;
        const perpRad = angleRad + Math.PI / 2;

        if (isNaN(angleRad) || isNaN(perpRad)) return;

        const courseColor = (this.selectedNavSource === "GPS") ? "#e049b0" : "#00ff00";
        const needleWidth = 8, needleLen = R * 0.90;
        const gapRadius = R * 0.6, gapPx = R * 0.15;

        // Triangle Dimensions
        const triHeight = 10;
        const triWidth = 30;

        // Match head and tail segment lengths
        const segOuter = needleLen - 10;
        const segInner = (gapRadius + gapPx / 2) - 30;

        ctx.save();
        try {
            ctx.strokeStyle = courseColor;
            ctx.fillStyle = courseColor;
            ctx.lineWidth = needleWidth;

            // --- 1. Draw Top Needle Segment ---
            ctx.beginPath();
            ctx.moveTo(cx + segOuter * Math.sin(angleRad), cy - segOuter * Math.cos(angleRad));
            ctx.lineTo(cx + segInner * Math.sin(angleRad), cy - segInner * Math.cos(angleRad));
            ctx.stroke();

            // --- 2. Draw Rotating Triangle (Arrowhead) ---
            const offset = 5;
            const triPeakDist = segOuter + offset;

            const peakX = cx + triPeakDist * Math.sin(angleRad);
            const peakY = cy - triPeakDist * Math.cos(angleRad);

            const baseX = cx + (triPeakDist - triHeight) * Math.sin(angleRad);
            const baseY = cy - (triPeakDist - triHeight) * Math.cos(angleRad);

            const corner1X = baseX + (triWidth / 2) * Math.sin(perpRad);
            const corner1Y = baseY - (triWidth / 2) * Math.cos(perpRad);
            const corner2X = baseX - (triWidth / 2) * Math.sin(perpRad);
            const corner2Y = baseY + (triWidth / 2) * Math.cos(perpRad);

            ctx.beginPath();
            ctx.moveTo(peakX, peakY);
            ctx.lineTo(corner1X, corner1Y);
            ctx.lineTo(corner2X, corner2Y);
            ctx.closePath();
            ctx.fill();

            // --- 3. Draw Bottom Needle Segment ---
            ctx.beginPath();
            ctx.moveTo(cx - segOuter * Math.sin(angleRad), cy + segOuter * Math.cos(angleRad));
            ctx.lineTo(cx - segInner * Math.sin(angleRad), cy + segInner * Math.cos(angleRad));
            ctx.stroke();

        } catch (e) {
            console.error("Gauge Render Error: ", e);
        } finally {
            ctx.restore();
        }
    }

    drawOptionLabel(ctx, lines, x, y, firstLineColor, secondLineColor) {
        const arr = Array.isArray(lines) ? lines : [String(lines || "")];

        // If a 3rd item exists, treat it as color metadata, not display text
        const hasColorMeta = arr.length > 2 && typeof arr[2] === "string" && arr[2].startsWith("#");
        const displayParts = hasColorMeta ? arr.slice(0, 2) : arr;

        const fullLabel = displayParts.join(" ");
        const lineGap = 12;

        if (fullLabel === "Brighter") {
            ctx.save();
            ctx.translate(x, y);

            ctx.beginPath();
            ctx.moveTo(0, -12);
            ctx.lineTo(-14, 8);
            ctx.lineTo(14, 8);
            ctx.closePath();

            const grad = ctx.createLinearGradient(0, -12, 0, 8);
            grad.addColorStop(0, "#d8f6ff");
            grad.addColorStop(1, "#26c6ff");
            ctx.fillStyle = grad;
            ctx.fill();

            ctx.restore();
            return;
        }

        if (fullLabel === "Dimmer") {
            ctx.save();
            ctx.translate(x, y);

            ctx.beginPath();
            ctx.moveTo(0, 12);
            ctx.lineTo(-14, -8);
            ctx.lineTo(14, -8);
            ctx.closePath();

            const grad = ctx.createLinearGradient(0, -8, 0, 12);
            grad.addColorStop(0, "#0b5d73");
            grad.addColorStop(1, "#26c6ff");
            ctx.fillStyle = grad;
            ctx.fill();

            ctx.restore();
            return;
        }

        if (fullLabel === "Backlight" && this.backlightImg && this.backlightImg.complete && this.backlightImg.naturalWidth > 0) {
            ctx.save();
            const w = 45;
            const h = 45;
            ctx.drawImage(this.backlightImg, x - w / 2, y - h / 2, w, h);
            ctx.restore();
            return;
        }

        if (displayParts.length <= 1) {
            ctx.save();
            ctx.fillStyle = firstLineColor || "#26c6ff";
            ctx.fillText(displayParts[0] || "", x, y);
            ctx.restore();
            return;
        }

        ctx.save();
        ctx.fillStyle = firstLineColor || "#26c6ff";
        ctx.fillText(displayParts[0], x, y - (lineGap / 2) - 5);
        ctx.restore();

        ctx.save();
        ctx.fillStyle = (secondLineColor !== undefined && secondLineColor !== null)
            ? secondLineColor
            : "#26c6ff";
        ctx.fillText(displayParts[1] || "", x, y + (lineGap / 2));
        ctx.restore();
    }

    drawOptions(ctx) {
        if (!this.showOptions) return;

        ctx.drawImage(this.images.options, 0, 0, 320, 320);

        ctx.save();

        const list = this.getCurrentOptionsList();

        const backBox = this.touchBoxes.find(b => b.id === "options_back");
        if (backBox) {
            const backSelected = (this.optionsSelIndex === 0);
            ctx.lineWidth = 2;
            ctx.strokeStyle = backSelected ? this.lightBlue : "rgba(255,255,255,0.85)";
            this.drawRoundedRect(ctx, backBox.x, backBox.y, backBox.w, backBox.h, 6);
        }

        const rows = [
            { id: "options_btn_1", row: 0 },
            { id: "options_btn_2", row: 1 },
            { id: "options_btn_3", row: 2 },
        ];

        for (const r of rows) {
            const box = this.touchBoxes.find(b => b.id === r.id);
            if (!box) continue;

            const firstVisibleIndex = 1 + (this.optionsScroll || 0);
            const absoluteIndex = firstVisibleIndex + r.row;

            const label = (absoluteIndex >= 0 && absoluteIndex < list.length) ? list[absoluteIndex] : "";
            const isSelected = (this.optionsSelIndex === absoluteIndex);

            ctx.lineWidth = 2;
            ctx.strokeStyle = isSelected ? this.lightBlue : "rgba(255,255,255,0.85)";
            this.drawRoundedRect(ctx, box.x, box.y, box.w, box.h, 6);

            if (!label) continue;

            const isToggleOn =
                (label === "CDI/VDI Preview" && !!this.cdiVdiPreviewOn) ||
                (label === "LOC CDI Prompt" && !!this.locCdiPromptOn) ||
                (this.optionsParent === "Misc. Field" && label === "Off" && this.miscOption === -1) ||
                (this.optionsParent === "Misc. Field" && label in this.miscFieldMapping && this.miscOption === this.miscFieldMapping[label]) ||
                (this.optionsParent === "Wind Settings" && label in this.windFieldMapping && this.windOption === this.windFieldMapping[label]);

            if (isToggleOn) {
                ctx.save();
                ctx.fillStyle = "#00ff00";
                const barH = 5;
                const padX = 6;
                const padY = 6;
                ctx.fillRect(box.x + padX, box.y + box.h - padY - barH, box.w - padX * 2, barH);
                ctx.restore();
            }

            const lines = this.getOptionLabelLines(label);

            ctx.font = "bold 14px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const isCrsRow = (label === "CRS");
            const crsEditable = !isCrsRow || this.isCrsEditable();

            const firstLineColor = crsEditable ? this.lightBlue : "rgba(38,198,255,0.35)";
            const secondLineColor = (lines.length > 2 && lines[2])
                ? lines[2]
                : (crsEditable ? this.lightBlue : "rgba(38,198,255,0.35)");

            this.drawOptionLabel(
                ctx,
                lines,
                box.x + box.w / 2,
                box.y + box.h / 2 + 2,
                firstLineColor,
                secondLineColor
            );
        }

        ctx.restore();
    }


    // --- ADI PAGE METHODS ---

    // Only fetch these variables when the ADI page is visible to save performance
    getAdiSimVars() {
        if (typeof SimVar !== "undefined" && typeof SimVar.GetSimVarValue === "function") {
            this.yaw_slip = SimVar.GetSimVarValue("TURN COORDINATOR BALL", "position");
            // Flight Director bars
            const fdPitchRad = SimVar.GetSimVarValue("AUTOPILOT FLIGHT DIRECTOR PITCH", "radians") || 0;
            const fdBankRad = SimVar.GetSimVarValue("AUTOPILOT FLIGHT DIRECTOR BANK", "radians") || 0;
            this.fdPitch = fdPitchRad * (180 / Math.PI);
            this.fdBank = fdBankRad * (180 / Math.PI) / 5;//adjust higher for lower bank angles
            this.fdActive = !!SimVar.GetSimVarValue("L:PMS50_APGA_FD_BUTTON_STATE", "Bool");

            const pressureAlt = SimVar.GetSimVarValue("PLANE ALTITUDE", "feet") || 0;
            const pfdBaro = this.baro || 29.92;
            this.alt = pressureAlt + (pfdBaro - 29.92) * 1000;

            this.pitch = SimVar.GetSimVarValue("PLANE PITCH DEGREES", "degrees");
            this.bank = SimVar.GetSimVarValue("PLANE BANK DEGREES", "degrees");
            this.heading = SimVar.GetSimVarValue("PLANE HEADING DEGREES MAGNETIC", "degrees") || 0;
            this.trueCourse = SimVar.GetSimVarValue("PLANE HEADING DEGREES TRUE", "degrees") || 0;
            this.magVar = SimVar.GetSimVarValue("MAGVAR", "degrees") || 0;
            this.ias = Number(((SimVar.GetSimVarValue("AIRSPEED INDICATED", "Knots") || 0) * 1.15078).toFixed(1));
            this.VS = SimVar.GetSimVarValue("VERTICAL SPEED", "Feet per minute");
            this.headingBug = SimVar.GetSimVarValue("AUTOPILOT HEADING LOCK DIR:1", "degrees") || 0;
            this.airspeedBug = Math.round((SimVar.GetSimVarValue("AUTOPILOT AIRSPEED HOLD VAR", "Knots") || 0) * 1.15078);
            this.altitudeBug = SimVar.GetSimVarValue("L:PMS50_APGA_SELECTED_ALTITUDE", "feet") || 0;
            this.groundSpeed = Number(((SimVar.GetSimVarValue("GPS GROUND SPEED", "knots") || 0) * 1.15078).toFixed(1));
            this.TAS = Number(((SimVar.GetSimVarValue("AIRSPEED TRUE", "knots") || 0) * 1.15078).toFixed(1));
            const vr = SimVar.GetSimVarValue("L:Vr.1", "number");
            if (Number.isFinite(vr)) this.Vr = vr;
            const vx = SimVar.GetSimVarValue("L:Vx.1", "number");
            if (Number.isFinite(vx)) this.Vx = vx;
            const vy = SimVar.GetSimVarValue("L:Vy.1", "number");
            if (Number.isFinite(vy)) this.Vy = vy;
            const vg = SimVar.GetSimVarValue("L:Vg.1", "number");
            if (Number.isFinite(vg)) this.Vg = vg;
            this.baro = SimVar.GetSimVarValue("L:PFD_BARO", "number") || 29.92;
            this.RA = SimVar.GetSimVarValue("PLANE ALT ABOVE GROUND", "feet");

            this.minimumsBugOn = 0; // set permenently off for now
            this.minimumsDh = 0; // set permenently off for now
        }
    }

    drawHorizon(ctx) {
        const horizonImg = this.images.horizonImg;
        const horizonNumbersImg = this.images.horizonNumbersImg;

        if (!horizonImg || horizonImg.naturalWidth === 0) return;

        const width = this.canvas.width;
        const height = this.canvas.height;
        let pitch = this.pitch || 0;
        let roll = this.bank || 0;
        const pitchPixelsPerDeg = 6; // Matching your PFD scaling

        // --- PART 1: Draw the full background image (Moves Freely) ---
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.rotate(roll * Math.PI / 180);
        ctx.translate(0, -pitch * pitchPixelsPerDeg);

        // Draw the main artificial horizon background
        ctx.drawImage(
            horizonImg,
            -horizonImg.naturalWidth / 2,
            -horizonImg.naturalHeight / 2,
            horizonImg.naturalWidth,
            horizonImg.naturalHeight
        );
        ctx.restore();

        // --- PART 2: Draw the numbers (Clipped to Viewport) ---
        if (horizonNumbersImg && horizonNumbersImg.naturalWidth > 0) {
            ctx.save();

            const scaleY = 0.5;

            // 1. Clipping
            ctx.beginPath();
            const clipHeight = 150;
            ctx.rect(0, (height / 2) - (clipHeight / 2), width, clipHeight);
            ctx.clip();

            // 2. Move to the center of the canvas first
            ctx.translate(width / 2, height / 2);
            ctx.rotate(roll * Math.PI / 180);

            // 3. APPLY SCALE FIRST
            ctx.scale(0.3, scaleY);

            // 4. APPLY TRANSLATION AFTER SCALE
            ctx.translate(0, -pitch * (pitchPixelsPerDeg / scaleY));

            // 5. Draw the image at its center
            const imgW = horizonNumbersImg.naturalWidth;
            const imgH = horizonNumbersImg.naturalHeight;

            ctx.drawImage(
                horizonNumbersImg,
                -imgW / 2,
                -imgH / 2,
                imgW,
                imgH
            );

            ctx.restore();
        }
    }

    drawBank(ctx) {
        if (!this.images.bank_angleImg.complete || this.images.bank_angleImg.naturalWidth === 0) return;
        const width = this.canvas.width, height = this.canvas.height;
        let roll = this.bank || 0;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, width, 80);
        ctx.clip();

        ctx.translate(width / 2, (height / 2) - 30);
        let tweak = 1.15;
        ctx.rotate((roll * tweak) * Math.PI / 180);

        ctx.drawImage(
            this.images.bank_angleImg,
            -this.images.bank_angleImg.naturalWidth / 2,
            -this.images.bank_angleImg.naturalHeight / 2,
            this.images.bank_angleImg.naturalWidth,
            this.images.bank_angleImg.naturalHeight
        );
        ctx.restore();
    }

    drawOverlay(ctx) {
        if (!this.images.overlayImg || this.images.overlayImg.naturalWidth === 0) return;
        ctx.drawImage(this.images.overlayImg, 0, 0, this.canvas.width, this.canvas.height);
    }

    drawSlipSkidIndicator(ctx) {
        const width = this.canvas.width;
        const line_length = 10;
        const line_thickness = 2;
        const px_per_unit = 10;
        const cx = width / 2;
        const top_y = 40;

        const slip = Number(this.yaw_slip) || 0;

        const slide_x = slip * px_per_unit;
        const x1 = cx - line_length / 2 + slide_x;
        const x2 = cx + line_length / 2 + slide_x;
        const y1 = top_y;
        const y2 = top_y;

        ctx.save();
        ctx.lineWidth = line_thickness;
        ctx.strokeStyle = "#fff";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
    }

    drawFlightDirector(ctx) {
        if (!this.images.fdImg || this.images.fdImg.naturalWidth === 0) return;
        if (!this.fdActive) return;

        const fdImgW = 131;
        const fdImgH = 28;
        const fdImgX = 95;
        const fdImgY = 160;

        const fdCenterX = fdImgX + fdImgW / 2;
        const fdCenterY = fdImgY + fdImgH / 2;

        const aircraftPitchDeg = Number(this.pitch) || 0;
        const aircraftBankDeg = Number(this.bank) || 0;

        const fdPitchCmdDeg = -(Number(this.fdPitch) || 0);
        const fdBankCmdDeg = (Number(this.fdBank) || 0);

        const pitchErrorDeg = fdPitchCmdDeg + aircraftPitchDeg;
        const bankErrorDeg = fdBankCmdDeg - aircraftBankDeg;

        const fdPixelsPerDeg = 6.0;
        let pitchPixels = -pitchErrorDeg * fdPixelsPerDeg;

        pitchPixels = Math.max(-80, Math.min(50, pitchPixels));

        ctx.save();
        ctx.translate(fdCenterX, fdCenterY + pitchPixels);
        ctx.rotate(-bankErrorDeg * Math.PI / 180);
        ctx.drawImage(this.images.fdImg, -fdImgW / 2, -fdImgH / 2, fdImgW, fdImgH);
        ctx.restore();
    }

    drawTapeShade(ctx) {
        if (!this.images.tapeShadeImg.complete || this.images.tapeShadeImg.naturalWidth === 0) return;
        ctx.drawImage(this.images.tapeShadeImg, 0, 0, this.canvas.width, this.canvas.height);
    }

    drawAltitudeTape(ctx) {
        const w = this.canvas.width, h = this.canvas.height;
        const cx = w / 2, cy = h / 2;
        const R = Math.min(w, h) * 0.43;

        const altBox = this.touchBoxes[14];//alt touchbox
        const baroBox = this.touchBoxes[15];//baro touchbox

        const visibleRangeFeet = 250;
        const tickMajor = 100;
        const tickMinor = 50;
        const yClipTop = altBox.y + altBox.h;
        const yClipBot = baroBox.y;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx, yClipTop, w - cx, yClipBot - yClipTop);
        ctx.clip();

        const thetaTop = Math.asin((yClipTop - cy) / R);
        const thetaZero = 0;
        const thetaBot = Math.asin((yClipBot - cy) / R);

        for (let tickFeet = Math.floor((this.alt - visibleRangeFeet) / tickMinor) * tickMinor;
            tickFeet <= Math.ceil((this.alt + visibleRangeFeet) / tickMinor) * tickMinor;
            tickFeet += tickMinor) {
            const offset = tickFeet - this.alt;
            if (offset < -visibleRangeFeet - 2 || offset > visibleRangeFeet + 2) continue;
            let theta;
            if (offset < 0) {
                let tBot = (offset + visibleRangeFeet) / visibleRangeFeet;
                theta = thetaBot + tBot * (thetaZero - thetaBot);
            } else {
                let tTop = offset / visibleRangeFeet;
                theta = thetaZero + tTop * (thetaTop - thetaZero);
            }
            const isMajor = tickFeet % tickMajor === 0;
            const r1 = R + 5;
            const r2 = r1 - (isMajor ? 12 : 8);
            const x1 = cx + r1 * Math.cos(theta);
            const y1 = cy + r1 * Math.sin(theta);
            const x2 = cx + r2 * Math.cos(theta);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y1);
            ctx.lineWidth = isMajor ? 2 : 1.2;
            ctx.strokeStyle = "#fff";
            ctx.stroke();
            if (isMajor) {
                let absFeet = Math.abs(tickFeet);
                let labelRadius = R - 12;

                if (absFeet >= 10000) {
                    let h = Math.floor(absFeet / 100);
                    let hundreds = Math.floor(h / 10);
                    let lx = cx + labelRadius * Math.cos(theta) - 29;
                    let ly = y1;
                    ctx.save();
                    ctx.textAlign = "left";
                    ctx.font = "15px MSFS_LABEL";
                    ctx.fillStyle = "#fff";
                    ctx.fillText(hundreds.toString(), lx, ly);
                    ctx.restore();
                }

                if (absFeet >= 1000) {
                    let thousands = Math.abs(Math.floor(tickFeet / 1000) % 10);
                    let lx = cx + labelRadius * Math.cos(theta) - 13;
                    let ly = y1;

                    ctx.save();
                    ctx.font = "15px MSFS_LABEL";
                    ctx.fillStyle = "#fff";
                    ctx.textAlign = "left";
                    ctx.fillText(thousands.toString(), lx, ly);
                    ctx.restore();
                }
                let hundreds = Math.abs(Math.floor(tickFeet / 100) % 10);
                let lx = cx + labelRadius * Math.cos(theta) - 4;
                let ly = y1;
                ctx.save();
                ctx.font = "10px MSFS_LABEL";
                ctx.fillStyle = "#fff";
                ctx.textAlign = "left";
                ctx.fillText(hundreds.toString(), lx, ly);
                ctx.restore();
            }
        }

        const maxTrend = 0.3;
        let trendDeltaFeet = (this.VS / 60) * 7;//alt in 7 seconds trend
        if (Math.abs(trendDeltaFeet) < 1) trendDeltaFeet = 0; // Don't show arc at near-zero VS
        let trendRatio = (trendDeltaFeet / 400);
        let arcSize = Math.abs(maxTrend * trendRatio);
        ctx.save();
        ctx.beginPath();
        if (trendDeltaFeet > 0) {
            ctx.arc(cx - 2, cy, R + 5, 0, Math.PI * (2 - arcSize), true);
        } else {
            ctx.arc(cx - 2, cy, R + 5, 0, Math.PI * arcSize, false);
        }
        ctx.strokeStyle = "#ff0fff";
        ctx.lineWidth = 8;
        ctx.globalAlpha = 0.8;
        ctx.stroke();
        ctx.restore();
        ctx.restore();

        // Draw bug overlay after tape for clean overlap
        this.drawAltitudeBug(ctx, cx, cy, R + 5, this.alt, 40, -40, 10);

        // Draw minimums (DH) bug on tape
        if (this.minimumsBugOn) {
            this.drawMinimumsBug(ctx, cx, cy, R + 5, this.alt, 40, -40, 0);
        }
    }

    drawMinimumsBug(ctx, cx, cy, tapeRadius, altCenter, arcStart, arcEnd, offsetX) {
        const dh = this.minimumsDh;
        if (!isFinite(dh) || dh <= 0) return;

        const span = 600; // same span as altitude bug
        const altBot = altCenter - span / 2;
        const altTop = altCenter + span / 2;

        // Clamp position to visible arc (park at ends)
        const clamped = Math.max(altBot, Math.min(altTop, dh));
        const frac = (clamped - altBot) / (altTop - altBot);
        const angleDeg = arcStart + frac * (arcEnd - arcStart);
        const angleRad = angleDeg * Math.PI / 180;

        // Color logic
        const diff = Math.abs(this.alt - dh);
        let color = "#26c6ff"; // cyan
        if (diff <= 100) color = "#ffffff"; // within 100 ft
        if (this.alt <= dh) color = "#ffff00"; // reached

        // Bug geometry: _^_ style
        const r = tapeRadius - 6;
        const x = cx + r * Math.cos(angleRad) + offsetX;
        const y = cy + r * Math.sin(angleRad);

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angleRad + Math.PI / 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        ctx.beginPath();
        // left flat
        ctx.moveTo(-10, 0);
        ctx.lineTo(-2, 0);
        // up caret
        ctx.lineTo(0, -5);
        ctx.lineTo(2, 0);
        // right flat
        ctx.lineTo(10, 0);
        ctx.stroke();

        ctx.restore();

    }

    drawAltitudeBug(ctx, cx, cy, tape_radius, alt_center, arc_start, arc_end, offset_x) {
        const bugAlt = this.altitudeBug;
        const span = 600;
        const alt_bot = alt_center - span / 2;
        const alt_top = alt_center + span / 2;

        if (bugAlt < alt_bot || bugAlt > alt_top) return;

        const frac = (bugAlt - alt_bot) / (alt_top - alt_bot);
        const bug_angle_offset_deg = -2;
        const bug_angle_deg = arc_start + frac * (arc_end - arc_start) + bug_angle_offset_deg;
        const bug_angle_rad = bug_angle_deg * Math.PI / 180;

        const bug_radius = tape_radius - 11;

        const bug_x = cx + bug_radius * Math.cos(bug_angle_rad) + offset_x;
        const bug_y = cy + bug_radius * Math.sin(bug_angle_rad);

        if (!this.images.altBugImg.complete || this.images.altBugImg.naturalWidth === 0) return;

        ctx.save();
        ctx.translate(bug_x, bug_y);
        ctx.rotate(bug_angle_rad);
        ctx.scale(-1, 1);
        ctx.drawImage(
            this.images.altBugImg,
            -this.images.altBugImg.naturalWidth / 2,
            -this.images.altBugImg.naturalHeight / 2,
            this.images.altBugImg.naturalWidth,
            this.images.altBugImg.naturalHeight
        );
        ctx.restore();
    }

    drawVerticalSpeedIndicator(ctx, cx, cy, R) {
        let vsFpm = Math.round(this.VS);
        if (!isFinite(vsFpm)) vsFpm = 0;
        const vsThousand = Math.abs(vsFpm / 1000);

        const boxW = 30, boxH = 15;
        const boxColor = vsFpm >= 0 ? "#444" : "#e33";
        const outline = "#fff";
        const textColor = "#fff";
        const fontSize = "600 13px MSFS_LABEL";
        const yOffset = R * 0.33 - 25;
        const xOffset = R * 0.66 - 30;
        const boxX = cx + xOffset;
        const boxY = cy + yOffset;

        ctx.save();
        ctx.beginPath();
        ctx.rect(boxX, boxY, boxW, boxH);
        ctx.fillStyle = boxColor;
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = outline;
        ctx.stroke();

        ctx.font = fontSize;
        ctx.fillStyle = textColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        let arrow = " ";
        if (vsFpm > 0) arrow = "^";
        else if (vsFpm < 0) arrow = "v";
        if (vsFpm === 0) {
            ctx.fontSize = "4px MSFS_LABEL";
            ctx.fillText("v", (boxX + boxW / 2) - 10, boxY + boxH / 2 - 5);
            ctx.fillText("s", (boxX + boxW / 2) - 10, boxY + boxH / 2 + 3);
        }
        ctx.fillText(arrow + vsThousand.toFixed(1), boxX + boxW / 2, boxY + boxH / 2 - 1);

        ctx.restore();
    }

    drawAirspeedTape(ctx) {
        const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
        const tape_radius = Math.min(this.canvas.width, this.canvas.height) * 0.43;
        const arc_start = 120, arc_end = 190, angle_offset = 25;

        // Display values are in MPH (this.ias is converted to MPH in getSimVars)
        const span = 60; // MPH span shown on tape
        const ias = Math.max(0, this.ias);
        const top = ias + span / 2;
        const bot = ias - span / 2;

        if (!isFinite(top) || !isFinite(bot) || top === bot) return;

        // V-speeds (you said these are already in MPH)
        const Vso = this.Vso, Vs = this.Vs, Vfe = this.Vfe, Vno = this.Vno, redMax = this.redMax;
        const Vr = this.Vr, Vx = this.Vx, Vy = this.Vy, Vg = this.Vg;

        const colorGreen = "#006400", colorYellow = "#f2e200", colorRed = "#ff0000", colorWhite = "#ffffff";
        const lightBlue = "#48b6ff";

        // tick geometry (we'll align band radius to tick/label radius)
        const tick_inner = tape_radius - 18;
        const tick_length_major = 15, tick_length_minor = 10;
        const tick_base_for_labels = tick_inner + tick_length_major;
        const label_x_offset = 35;

        // helper: speed -> angle (radians)
        const toAngleRad = (speed) => {
            const frac = (speed - bot) / (top - bot);
            const angleDeg = arc_start + frac * (arc_end - arc_start) + angle_offset;
            return angleDeg * Math.PI / 180;
        };

        // draw one contiguous arc from s1 to s2 (clamped to visible range)
        const drawBandOneArc = (s1, s2, color, width = 16, rOffset = 0) => {
            if (s2 < bot || s1 > top) return;
            const s1c = Math.max(bot, Math.min(top, s1));
            const s2c = Math.max(bot, Math.min(top, s2));
            if (s2c <= s1c) return;

            // angles in radians
            let a1 = toAngleRad(s1c);
            let a2 = toAngleRad(s2c);
            if (a2 < a1) { const t = a1; a1 = a2; a2 = t; }

            // Align band radius to the tick/label radius so endpoints visually line up
            const bandRadius = tick_base_for_labels + rOffset;

            ctx.save();
            ctx.lineWidth = width;
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.arc(cx, cy, bandRadius, a1, a2, false);
            ctx.stroke();
            ctx.restore();
        };

        // draw the bands (order: green / yellow / white / red)
        drawBandOneArc(Vs, Vno, colorGreen, 16, +0);       // green band
        drawBandOneArc(Vno, redMax, colorYellow, 16, +0);  // yellow band
        drawBandOneArc(Vso, Vfe, colorWhite, 7, -6);      // white band — slightly inward so it visually matches former look
        drawBandOneArc(redMax - 3, redMax, colorRed, 16, +0); // red marker

        // Draw ticks & labels (major every 10, minor every 5)
        ctx.save();
        ctx.font = "15px MSFS_LABEL";
        const minor = 5, major = 10;
        let tick_start_val = Math.floor(bot / minor) * minor;
        for (let k = tick_start_val; k <= top; k += minor) {
            if (k < 0) continue;
            const frac = (k - bot) / (top - bot);
            const angle_deg = arc_start + frac * (arc_end - arc_start) + angle_offset;
            const angle = angle_deg * Math.PI / 180;
            const is_major = (k % major === 0);

            const tick_length = is_major ? tick_length_major : tick_length_minor;
            const tick_thick = is_major ? 3 : 1.5;
            const tick_base = tick_inner + (is_major ? 0 : (tick_length_major - tick_length_minor));
            const x1 = cx + tick_base * Math.cos(angle) - 10;
            const y1 = cy + tick_base * Math.sin(angle);
            const x2 = cx + tick_base_for_labels * Math.cos(angle) - 10;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y1);
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = tick_thick;
            ctx.stroke();
            ctx.restore();

            if (is_major && k > 0 && k <= top) {
                ctx.save();
                ctx.textAlign = "right";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "#fff";
                ctx.fillText(k.toString(), x2 + label_x_offset, y1, 44, 10);
                ctx.restore();
            }
        }
        ctx.restore();

        // Draw V-speed markers (<R, <X, <Y) / (<G) -- mutually exclusive set based on AGL+climb
        const aglFt = Number(this.RA);
        const vsFpm = Number(this.VS);

        // "takeoff/initial climb" condition
        const showTakeoffSpeeds = isFinite(aglFt) && isFinite(vsFpm) && (aglFt < 2000) && (vsFpm >= 0);

        // Choose which set to display (never both)
        const bugSpecs = showTakeoffSpeeds
            ? [
                { key: "Vr", value: Vr, label: "<R" },
                { key: "Vx", value: Vx, label: "<X" },
                { key: "Vy", value: Vy, label: "<Y" }
            ]
            : [
                { key: "Vg", value: Vg, label: "<G" }
            ];

        for (let bug of bugSpecs) {
            //if (!this.vSpeedShow || !this.vSpeedShow[bug.key]) continue;
            if (typeof bug.value !== "number" || !isFinite(bug.value)) continue;
            if (bug.value > bot && bug.value <= top) {
                const frac = (bug.value - bot) / (top - bot);
                const angle_deg = arc_start + frac * (arc_end - arc_start) + angle_offset;
                const angle = angle_deg * Math.PI / 180;
                const bug_radius = tick_base_for_labels - 12;
                const bug_x = cx + bug_radius * Math.cos(angle) - 20;
                const bug_y = cy + bug_radius * Math.sin(angle) + 2;

                ctx.save();
                ctx.font = "600 14px MSFS_LABEL";
                ctx.fillStyle = lightBlue;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(bug.label, bug_x, bug_y);
                ctx.restore();
            }
        }

        // Draw the selected airspeed bug (if within visible range)
        if (typeof this.airspeedBug === "number" && isFinite(this.airspeedBug)) {
            if (this.airspeedBug >= bot && this.airspeedBug <= top && this.images.altBugImg.complete && this.images.altBugImg.naturalWidth > 0) {
                const frac = (this.airspeedBug - bot) / (top - bot);
                const angle_deg = arc_start + frac * (arc_end - arc_start) + angle_offset;
                const angle = angle_deg * Math.PI / 180;
                const bug_radius = tape_radius - 10;
                const bug_x = cx + bug_radius * Math.cos(angle) - 15;
                const bug_y = cy + bug_radius * Math.sin(angle);
                ctx.save();
                ctx.translate(bug_x, bug_y);
                ctx.rotate(angle + Math.PI);
                ctx.drawImage(this.images.altBugImg, -7, -12, 15, 25);
                ctx.restore();
            }
        }
    }

    drawCurrentAirspeedBox(ctx, cx, cy, R) {
        const ias = Math.max(0, this.ias);

        // 1. Determine States
        const isRedAlert = ias >= this.redMax;
        const isYellowAlert = ias >= this.Vno && !isRedAlert;
        const isBelowThreshold = ias < 20;

        // Geometry
        const boxTopY = cy - 10;
        const digitW = 14;            // keep digit size the same
        const horizBoxH = 20;
        let vertBoxW = 20, vertBoxH = 32;

        // We only need hundreds and tens
        const horizDigits = 2;
        const horizBoxW = (horizDigits * digitW) + 6;

        // Keep the LEFT EDGE fixed regardless of width
        const oldThreeDigitWidth = (3 * digitW) + 6;
        const boxX = cx - R * 1.8 + oldThreeDigitWidth;

        // Vertical box position
        const vertBoxX = boxX + horizBoxW - 9;
        const vertBoxY = boxTopY - 5;
        const drumCenterY = vertBoxY + vertBoxH / 2;

        ctx.save();

        // 2. Draw Unified Box Outline (Sideways T)
        const boxBgColor = isRedAlert ? "#ff0000" : "#000";

        // Trace the exact outer perimeter of the overlapping horizontal and vertical boxes
        ctx.beginPath();
        ctx.moveTo(boxX, boxTopY); // Top-left of horizontal box
        ctx.lineTo(vertBoxX, boxTopY); // Right to vertical box's left edge
        ctx.lineTo(vertBoxX, vertBoxY); // Up to vertical box's top
        ctx.lineTo(vertBoxX + vertBoxW, vertBoxY); // Right across vertical box's top
        ctx.lineTo(vertBoxX + vertBoxW, vertBoxY + vertBoxH); // Down vertical box's right edge
        ctx.lineTo(vertBoxX, vertBoxY + vertBoxH); // Left across vertical box's bottom
        ctx.lineTo(vertBoxX, boxTopY + horizBoxH); // Up to horizontal box's bottom edge
        ctx.lineTo(boxX, boxTopY + horizBoxH); // Left to horizontal box's bottom-left corner
        ctx.closePath(); // Back to start

        // Fill and Stroke the unified shape
        ctx.fillStyle = boxBgColor;
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = "#FFFFFF"; // Solid white outline
        ctx.stroke();

        const DIGIT_FONT = "600 16px MSFS_LABEL";
        const sep = 12;

        if (isBelowThreshold) {
            ctx.fillStyle = "#FFFFFF";
            ctx.textBaseline = "middle";
            ctx.font = DIGIT_FONT;
            ctx.textAlign = "right";
            ctx.fillText("--", boxX + horizBoxW - 10, cy - 2);
            ctx.textAlign = "center";
            ctx.fillText("-", vertBoxX + vertBoxW / 2, drumCenterY - 2);
        } else {
            const ias_int = Math.floor(ias);
            const hundreds = Math.floor((ias_int % 1000) / 100);
            const tens = Math.floor((ias_int % 100) / 10);
            const ones = ias_int % 10;
            const fractional = ias - ias_int;

            // --- TRIGGER LOGIC ---
            let tensRemainder = (ones === 9) ? fractional : 0;
            let hundredsRemainder = (tens === 9 && ones === 9) ? fractional : 0;

            let colorRGB = isYellowAlert ? "242, 226, 0" : "255, 255, 255";
            ctx.font = DIGIT_FONT;
            ctx.textBaseline = "middle";

            const hunX = boxX + 0;
            const tenX = boxX - 2 + digitW;

            // --- HUNDREDS DRUM ---
            if (hundreds > 0 || (hundreds === 0 && hundredsRemainder > 0)) {
                ctx.save();
                ctx.beginPath(); ctx.rect(hunX, boxTopY + 2, digitW, horizBoxH - 4); ctx.clip();
                ctx.textAlign = "center";

                const hCurrent = hundreds;
                const hNext = (hundreds + 1) % 10;

                ctx.fillStyle = `rgba(${colorRGB}, ${1 - hundredsRemainder})`;
                ctx.fillText(hCurrent, hunX + digitW / 2, cy + 1 - (hundredsRemainder * sep));

                if (hundredsRemainder > 0) {
                    ctx.fillStyle = `rgba(${colorRGB}, ${hundredsRemainder})`;
                    ctx.fillText(hNext, hunX + digitW / 2, cy + 1 + sep - (hundredsRemainder * sep));
                }
                ctx.restore();
            }

            // --- TENS DRUM ---
            ctx.save();
            ctx.beginPath(); ctx.rect(tenX, boxTopY + 2, digitW, horizBoxH - 4); ctx.clip();
            ctx.textAlign = "center";

            const tensCurrent = tens;
            const tensNext = (tens + 1) % 10;

            ctx.fillStyle = `rgba(${colorRGB}, ${1 - tensRemainder})`;
            ctx.fillText(tensCurrent, tenX + digitW / 2, cy + 1 - (tensRemainder * sep));

            if (tensRemainder > 0) {
                ctx.fillStyle = `rgba(${colorRGB}, ${tensRemainder})`;
                ctx.fillText(tensNext, tenX + digitW / 2, cy + 1 + sep - (tensRemainder * sep));
            }
            ctx.restore();

            // --- ONES DRUM (Vertical Box) ---
            ctx.save();
            ctx.beginPath(); ctx.rect(vertBoxX + 2, vertBoxY + 2, vertBoxW - 4, vertBoxH - 4); ctx.clip();
            ctx.textAlign = "center";

            ctx.fillStyle = `rgba(${colorRGB}, ${1 - fractional})`;
            ctx.fillText(ones, vertBoxX + vertBoxW / 2, drumCenterY - (fractional * sep));

            ctx.fillStyle = `rgba(${colorRGB}, ${fractional})`;
            ctx.fillText((ones + 1) % 10, vertBoxX + vertBoxW / 2, drumCenterY + sep - (fractional * sep));

            ctx.restore();
        }
        ctx.restore();
    }

    drawCurrentAltitudeBox(ctx, cx, cy, R) {
        const alt = Math.max(0, this.alt);

        // Visual states (no alerts on altitude box itself)
        const isBelowThreshold = alt < 20;

        // Geometry — right-side box, keep your layout
        const boxTopY = cy - 10;
        const digitW = 14;
        const horizBoxH = 20;
        const vertBoxW = 21, vertBoxH = 32;

        const horizDigits = 3; // thousands, hundreds, tens
        const horizBoxW = (horizDigits * digitW) + 6;

        const xOffset = -5; // keep your slight nudge
        const boxX = cx + R * 0.75 - horizBoxW + xOffset; // right side (RIGHT EDGE ANCHOR)
        const vertBoxX = boxX + horizBoxW - 3;
        const vertBoxY = boxTopY - 5;
        const drumCenterY = vertBoxY + vertBoxH / 2;

        // Shift ONLY the left edge of the horizontal box by 15px
        const leftTrim = 15; // keep the 15px trim

        ctx.save();

        // 1) Unified Box Outline (Sideways T)
        const hx1 = boxX + leftTrim;
        const hy1 = boxTopY;
        const hy2 = boxTopY + horizBoxH;

        const vx1 = vertBoxX;
        const vx2 = vertBoxX + vertBoxW;
        const vy1 = vertBoxY;
        const vy2 = vertBoxY + vertBoxH;

        // Trace the exact outer perimeter
        ctx.beginPath();
        ctx.moveTo(hx1, hy1); // Top-left of horizontal box
        ctx.lineTo(vx1, hy1); // Right to vertical box's left edge
        ctx.lineTo(vx1, vy1); // Up to vertical box's top edge
        ctx.lineTo(vx2, vy1); // Right across vertical box's top
        ctx.lineTo(vx2, vy2); // Down vertical box's right edge
        ctx.lineTo(vx1, vy2); // Left across vertical box's bottom
        ctx.lineTo(vx1, hy2); // Up to horizontal box's bottom edge
        ctx.lineTo(hx1, hy2); // Left to horizontal box's bottom-left corner
        ctx.closePath(); // Back to start

        // Fill and Stroke the unified shape
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = "#D9D9D9";
        ctx.stroke();

        const DIGIT_FONT = "600 16px MSFS_LABEL";
        const sep = 12;

        if (isBelowThreshold) {
            ctx.fillStyle = "#FFFFFF";
            ctx.textBaseline = "middle";
            ctx.font = DIGIT_FONT;
            ctx.textAlign = "right";
            ctx.fillText("---", boxX + horizBoxW - 4, cy + 1);
            ctx.textAlign = "center";
            ctx.fillText("--", vertBoxX + vertBoxW / 2, drumCenterY);
            ctx.restore();
            return;
        }

        // 2) Altitude decomposition (unchanged)
        const thousandsDigit = Math.floor(alt / 10000);            // ten-thousands place (0–9)
        const hundredsDigit = Math.floor((alt % 10000) / 1000);   // thousands place   (0–9)
        const tensDigit = Math.floor((alt % 1000) / 100);     // hundreds place    (0–9)

        // Vertical drum: two-digit 00/20/40/60/80 values
        const withinHundred = alt % 100;
        const stepSize = 20;
        const stepIndex = Math.floor(withinHundred / stepSize);
        const stepFraction = (withinHundred % stepSize) / stepSize;
        const drumValues = [0, 20, 40, 60, 80];
        const currentDrumVal = drumValues[stepIndex];
        const nextDrumVal = drumValues[(stepIndex + 1) % 5];

        // 3) Cascade trigger logic (unchanged)
        let tensRemainder = (stepIndex === 4) ? stepFraction : 0;

        const withinThousand = alt % 1000;
        let hundredsRemainder = (withinThousand >= 980)
            ? (withinThousand - 980) / 20
            : 0;

        const withinTenThousand = alt % 10000;
        let thousandsRemainder = (withinTenThousand >= 9980)
            ? (withinTenThousand - 9980) / 20
            : 0;

        // 4) Colors and baseline
        let colorRGB = "255, 255, 255";
        ctx.font = DIGIT_FONT;
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";

        // --- SQUISH: bring columns closer while keeping rightmost fixed ---
        // Default centers are separated by digitW (14). Reduce each gap by 6 px.
        const squish = 6;                 // per-gap reduction
        const step = digitW - squish;     // new spacing between column left-edges

        // Keep tens column fixed (rightmost)
        const tenX = boxX + 3 + digitW * 2;     // left of tens column (unchanged)
        const hunX = tenX - step;              // moved right by 'squish'
        const thouX = hunX - step;              // moved right by 2 * 'squish'

        // --- THOUSANDS DRUM (ten-thousands place, leftmost) ---
        if (thousandsDigit > 0 || thousandsRemainder > 0) {
            ctx.save();
            // Keep full column clip width to preserve glyph; overlap is fine visually here
            ctx.beginPath(); ctx.rect(thouX, boxTopY + 2, digitW, horizBoxH - 4); ctx.clip();

            const thCurrent = thousandsDigit;
            const thNext = (thousandsDigit + 1) % 10;

            ctx.fillStyle = `rgba(${colorRGB}, ${1 - thousandsRemainder})`;
            ctx.fillText(thCurrent, thouX + digitW / 2, cy + 1 - (thousandsRemainder * sep));

            if (thousandsRemainder > 0) {
                ctx.fillStyle = `rgba(${colorRGB}, ${thousandsRemainder})`;
                ctx.fillText(thNext, thouX + digitW / 2, cy + 1 + sep - (thousandsRemainder * sep));
            }
            ctx.restore();
        }

        // --- HUNDREDS DRUM (thousands place, middle) ---
        if (thousandsDigit > 0 || hundredsDigit > 0 || hundredsRemainder > 0) {
            ctx.save();
            ctx.beginPath(); ctx.rect(hunX, boxTopY + 2, digitW, horizBoxH - 4); ctx.clip();

            const hCurrent = hundredsDigit;
            const hNext = (hundredsDigit + 1) % 10;

            ctx.fillStyle = `rgba(${colorRGB}, ${1 - hundredsRemainder})`;
            ctx.fillText(hCurrent, hunX + digitW / 2, cy + 1 - (hundredsRemainder * sep));

            if (hundredsRemainder > 0) {
                ctx.fillStyle = `rgba(${colorRGB}, ${hundredsRemainder})`;
                ctx.fillText(hNext, hunX + digitW / 2, cy + 1 + sep - (hundredsRemainder * sep));
            }
            ctx.restore();
        }

        // --- TENS DRUM (hundreds place, rightmost) ---
        ctx.save();
        ctx.beginPath(); ctx.rect(tenX, boxTopY + 2, digitW, horizBoxH - 4); ctx.clip();

        const tensCurrent = tensDigit;
        const tensNext = (tensDigit + 1) % 10;

        ctx.fillStyle = `rgba(${colorRGB}, ${1 - tensRemainder})`;
        ctx.fillText(tensCurrent, tenX + digitW / 2, cy + 1 - (tensRemainder * sep));

        if (tensRemainder > 0) {
            ctx.fillStyle = `rgba(${colorRGB}, ${tensRemainder})`;
            ctx.fillText(tensNext, tenX + digitW / 2, cy + 1 + sep - (tensRemainder * sep));
        }
        ctx.restore();

        // --- ONES DRUM (Vertical box) — unchanged
        ctx.save();
        ctx.beginPath(); ctx.rect(vertBoxX + 2, vertBoxY + 2, vertBoxW - 4, vertBoxH - 4); ctx.clip();
        ctx.textAlign = "center";

        const drumText = String(currentDrumVal).padStart(2, "0");
        const nextDrumText = String(nextDrumVal).padStart(2, "0");

        ctx.fillStyle = `rgba(${colorRGB}, ${1 - stepFraction})`;
        ctx.fillText(drumText, vertBoxX + vertBoxW / 2, drumCenterY - (stepFraction * sep));

        ctx.fillStyle = `rgba(${colorRGB}, ${stepFraction})`;
        ctx.fillText(nextDrumText, vertBoxX + vertBoxW / 2, drumCenterY + sep - (stepFraction * sep));

        ctx.restore();
        ctx.restore();
    }

    drawBaro(ctx) {
        const { x: boxX, y: boxY, w: boxW, h: boxH } = this.touchBoxes[15];
        ctx.save();
        ctx.font = "12px MSFS_LABEL";
        ctx.fillStyle = "#00eaff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        let baroStr = (this.baro !== undefined && this.baro !== null) ? this.baro.toFixed(2) + " in" : "---- in";
        ctx.fillText(baroStr, (boxX + boxW / 2) - 10, boxY + boxH / 2 + 1);
        ctx.restore();
    }

    drawAirspeedBugBox(ctx) {
        const { x: boxX, y: boxY, w: boxW, h: boxH } = this.touchBoxes[13];
        let mph = this.airspeedBug;
        ctx.font = "12px MSFS_LABEL";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#00eaff";
        let bugText = (this.airspeedBug !== undefined && this.airspeedBug !== null)
            ? Math.round(mph).toString()
            : "---";
        ctx.fillText(bugText, 30 + boxX + boxW / 2, -3 + boxY + boxH / 2);
        ctx.restore();
    }

    drawAltitudeSelectBox(ctx) {
        // altitude alert logic not enabled
        //this.updateAltitudeAlertType();
        const { x: boxX, y: boxY, w: boxW, h: boxH } = this.touchBoxes[14];
        ctx.save();

        //if (this.altAlertType === 1 && this.altAlertFlash) {
        //    ctx.drawImage(this.altAlertImg, 0, 0, this.canvas.width, this.canvas.height);
        //}

        ctx.font = "12px MSFS_LABEL";
        let altSelect = (this.altitudeBug !== undefined && this.altitudeBug !== null)
            ? Math.round(this.altitudeBug).toLocaleString()
            : "----";

        //if (this.altAlertType === 1 && this.altAlertFlash) {
        //    ctx.fillStyle = "#000";
        //} else if (this.altAlertType === 2 && this.altAlertFlash) {
        //    ctx.fillStyle = "#000";
        //} else if (this.altAlertType === 3 && this.altAlertFlash) {
        //    ctx.fillStyle = "#ffff0f";
        //} else {
        ctx.fillStyle = "#00eaff";
        //}

        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(altSelect, boxX + boxW / 2, boxY + boxH / 2 - 2);

        ctx.restore();
    }

    drawHeadingBugBox(ctx) {// part of ADI
        const { x: boxX, y: boxY, w: boxW, h: boxH } = this.touchBoxes[16];

        ctx.save();
        let bugValue = this.trkHold ? this.trkSel : this.headingBug;
        let bugText = (typeof bugValue === "number")
            ? ((Math.round(bugValue) % 360).toString().padStart(3, "0"))
            : "---";
        ctx.font = "12px MSFS_LABEL";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#00eaff";

        const bugX = 19 + boxX + boxW / 2;
        const bugY = boxY + boxH / 2;

        ctx.fillText(bugText, bugX, bugY);

        let txtMetrics = ctx.measureText(bugText);
        let degX = bugX + (txtMetrics.width / 2) + 5;
        let degY = bugY - 6;

        this.drawDegreeSymbol(ctx, degX, degY, 1.5);

        ctx.font = "6px MSFS_LABEL";
        ctx.fillStyle = "#FFFFFF";
        let txt = this.trkHold ? "TRK" : "HDG";
        ctx.fillText(txt, 0 + boxX + boxW / 2, -3 + boxY + boxH / 2);

        ctx.restore();
    }

    drawHeadingTape(ctx) {
        ctx.restore();
        const tapeLeft = 45, tapeRight = this.canvas.width - 45;
        const tapeWidth = tapeRight - tapeLeft;
        const tapeTop = this.canvas.height - 80;
        const tapeHeight = 22;

        const totalSpan = 130;
        const majorStep = 10, minorStep = 5;
        let headingCenter = Math.round(this.heading) % 360;

        ctx.save();
        ctx.beginPath();
        ctx.rect(tapeLeft, tapeTop, tapeWidth, tapeHeight, 7);
        ctx.fillStyle = "#101018";
        ctx.fill();
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();

        // --- FIX: Snap ticks to absolute heading multiples ---
        const halfSpan = totalSpan / 2;
        const startHeading = Math.floor((headingCenter - halfSpan) / minorStep) * minorStep;
        const endHeading = Math.ceil((headingCenter + halfSpan) / minorStep) * minorStep;

        for (let tickHeading = startHeading; tickHeading <= endHeading; tickHeading += minorStep) {
            // Compute the offset from center heading (handling wrap-around)
            let d = tickHeading - headingCenter;
            if (d > 180) d -= 360;
            if (d < -180) d += 360;

            // Skip if outside the visible span
            if (d < -halfSpan || d > halfSpan) continue;

            const x = tapeLeft + tapeWidth / 2 + (d / totalSpan) * tapeWidth;
            const normalizedHeading = ((tickHeading % 360) + 360) % 360;
            const isMajor = (normalizedHeading % majorStep === 0);

            if (isMajor) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, tapeTop + 3);
                ctx.lineTo(x, tapeTop + 10);
                ctx.lineWidth = 1;
                ctx.strokeStyle = "#fff";
                ctx.stroke();
                ctx.restore();
            } else {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, tapeTop + 3);
                ctx.lineTo(x, tapeTop + 6);
                ctx.lineWidth = 1.2;
                ctx.strokeStyle = "#aaa";
                ctx.stroke();
                ctx.restore();
            }
        }

        const tapeLabelsDef = [
            { value: 0, label: "N" },
            { value: 30, label: "3" },
            { value: 60, label: "6" },
            { value: 90, label: "E" },
            { value: 120, label: "12" },
            { value: 150, label: "15" },
            { value: 180, label: "S" },
            { value: 210, label: "21" },
            { value: 240, label: "24" },
            { value: 270, label: "W" },
            { value: 300, label: "30" },
            { value: 330, label: "33" }
        ];
        for (const { value, label } of tapeLabelsDef) {
            let d = value - headingCenter;
            if (d > 180) d -= 360;
            if (d < -180) d += 360;
            if (d < -totalSpan / 2 || d > totalSpan / 2) continue;
            const x = tapeLeft + tapeWidth / 2 + (d / totalSpan) * tapeWidth;

            ctx.save();
            ctx.font = "12px MSFS_LABEL";
            ctx.fillStyle = "#fff";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.globalAlpha = 1.0;
            ctx.fillText(label, x, tapeTop + 10);
            ctx.restore();
        }

        const pointerX = tapeLeft + tapeWidth / 2;
        const pointerY = tapeTop + 18;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pointerX, pointerY - 8);
        ctx.lineTo(pointerX - 8, pointerY + 4);
        ctx.lineTo(pointerX + 8, pointerY + 4);
        ctx.closePath();
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.restore();

        let bugValue = this.trkHold ? this.trkSel : this.headingBug;
        let bugDiff = ((bugValue - headingCenter + 540) % 360) - 180;
        let frac = bugDiff / totalSpan;
        let bugX = tapeLeft + tapeWidth / 2 + frac * tapeWidth;
        let bugY = tapeTop + 5;
        let imgW = 14, imgH = 16;
        let halfW = imgW / 2;
        if (bugX < tapeLeft + halfW) bugX = tapeLeft + halfW;
        if (bugX > tapeRight - halfW) bugX = tapeRight - halfW;

        if (this.images.altBugImg.complete && this.images.altBugImg.naturalWidth > 0) {
            ctx.save();
            ctx.translate(bugX, bugY);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(this.images.altBugImg, -imgW / 2, -imgH / 2, imgW, imgH);
            ctx.restore();
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(pointerX - 12, tapeTop + tapeHeight - 12, 25, 11);
        ctx.fillStyle = "#101018";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#fff";
        ctx.stroke();

        ctx.font = "12px MSFS_LABEL";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        let hdgText = headingCenter === 0 ? "360" : headingCenter.toString().padStart(3, "0");
        let textX = pointerX - 3;
        ctx.fillText(hdgText, textX + 1, tapeTop + tapeHeight - 7);

        let txtMetrics = ctx.measureText(hdgText);
        let degX = textX + (txtMetrics.width / 2) + 3;
        let degY = tapeTop + tapeHeight - 9;
        this.drawDegreeSymbol(ctx, degX, degY, 1.5);

        ctx.restore();
    }

    drawADICDI(ctx, cx, cy, R) {
        if (!ctx) return;
        if (!this.navAvail && !this.isPreviewActive) return; // Show if active or preview is available

        // --- Geometry & Setup ---
        const barX = 105, barY = 227, barW = 115, barH = 14;
        const textY = barY;
        const isGPS = (this.selectedNavSource === "GPS");
        const sourceColor = isGPS ? (this.identColor || "#e049b0") : "#00ff00";
        const midX = barX + barW / 2;
        const cdiMaxDots = 2;
        const spanPerDot = barW / (2 * cdiMaxDots);

        // --- Background & Text Boxes ---
        if (this.images.cdiImg && this.images.cdiImg.complete) {
            ctx.drawImage(this.images.cdiImg, barX, barY, barW, barH);
        }
        let x1 = 60;
        let x2 = barX + barW;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x1, barY, barX - x1, barH);
        ctx.rect(x2, barY, 50, barH);
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        ctx.restore();

        // --- Text Labels (Source & Phase) ---
        ctx.save();
        ctx.font = "600 12px MSFS_LABEL";
        ctx.fillStyle = sourceColor;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(this.navSourceText || "", x1 + 3, textY);
        ctx.fillText(this.phaseText || "", x2 + 3, textY);
        ctx.restore();

        // --- Helper to draw a deviation triangle ---
        const drawTriangle = (deflection, toFrom, color, isFilled) => {
            const normDots = Math.max(-127, Math.min(127, deflection)) / 127 * cdiMaxDots;
            let triX = Math.round(midX + normDots * spanPerDot);

            const triBaseW = 12;
            const triH = 10;
            const baseY = barY + barH - 2;

            // Clamp triangle inside the bar
            triX = Math.max(barX + triBaseW / 2, Math.min(barX + barW - triBaseW / 2, triX));

            ctx.beginPath();
            if (toFrom === 2) { // FROM: downward
                ctx.moveTo(triX, baseY + triH);
                ctx.lineTo(triX - triBaseW / 2, baseY);
                ctx.lineTo(triX + triBaseW / 2, baseY);
            } else { // TO or OFF: upward
                ctx.moveTo(triX, baseY - triH);
                ctx.lineTo(triX - triBaseW / 2, baseY);
                ctx.lineTo(triX + triBaseW / 2, baseY);
            }
            ctx.closePath();

            if (isFilled) {
                ctx.fillStyle = color;
                ctx.fill();
            } else {
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        };

        // --- Draw Preview CDI (Hollow) ---
        if (this.isPreviewActive) {
            ctx.save();
            ctx.globalAlpha = 0.6; // Ghosted appearance
            drawTriangle(this.previewCdiDeflection, this.previewToFrom, this.lightBlue, false);
            ctx.restore();
        }

        // --- Draw Active CDI (Filled) ---
        if (this.navAvail) {
            drawTriangle(this.cdiDeflection, Math.round(this.toFromFlag), sourceColor, true);
        }
    }

    stayOnNow() {
        this.stayOnOverride = true;
        this.shutdownActive = false;
        this.shutdownComplete = false;
        this.shutdownRemainingMs = 0;
    }

    drawLocCdiPrompt(ctx) {
        if (!this.locCdiPromptActive || !this.locCdiPromptFlash) return;

        const box = this.touchBoxes.find(b => b.id === "cdi");
        if (!box) return;

        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ff00ff";
        ctx.fillStyle = "rgba(255, 0, 255, 0.18)";
        this.drawRoundedRect(ctx, box.x, box.y, box.w, box.h, 6, "rgba(255, 0, 255, 0.18)");
        ctx.restore();
    }

    drawMapRangeRing(ctx, cx, cy, R) {
        ctx.save();

        // Match your map scale tweak used elsewhere
        const ringR = R * 0.6;

        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);

        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.restore();
    }

    getAltitudeInterceptDistanceNm() {
        // Need valid data
        const currentAlt = Number(SimVar.GetSimVarValue("INDICATED ALTITUDE", "feet")) || 0;
        const selectedAlt =
            Number(SimVar.GetSimVarValue("L:PMS50_APGA_SELECTED_ALTITUDE", "feet")) ||
            Number(SimVar.GetSimVarValue("AUTOPILOT ALTITUDE LOCK VAR", "feet")) ||
            0;
        const vsFpm = Number(SimVar.GetSimVarValue("VERTICAL SPEED", "feet per minute")) || 0;
        const gsKt = Number(SimVar.GetSimVarValue("GPS GROUND SPEED", "knots")) || 0;

        if (!isFinite(currentAlt) || !isFinite(selectedAlt) || !isFinite(vsFpm) || !isFinite(gsKt)) {
            return null;
        }

        // Ignore tiny VS / stopped on ground / no movement
        if (Math.abs(vsFpm) < 100 || gsKt < 20) {
            return null;
        }

        const deltaAlt = selectedAlt - currentAlt;

        // Must be moving toward selected altitude
        if ((deltaAlt > 0 && vsFpm <= 0) || (deltaAlt < 0 && vsFpm >= 0)) {
            return null;
        }

        const minutesToGo = Math.abs(deltaAlt / vsFpm);
        if (!isFinite(minutesToGo) || minutesToGo <= 0) {
            return null;
        }

        const distanceNm = gsKt * (minutesToGo / 60);
        if (!isFinite(distanceNm) || distanceNm < 0) {
            return null;
        }

        return distanceNm;
    }

    drawAltitudeInterceptArc(ctx, cx, cy, R) {
        if (!ctx) return;

        R = R * this.mapScaleTweak; // tweak scale

        const currentAltFt = Number(SimVar.GetSimVarValue("INDICATED ALTITUDE", "feet")) || 0;
        const selectedAltFt =
            Number(SimVar.GetSimVarValue("L:PMS50_APGA_SELECTED_ALTITUDE", "feet")) ||
            Number(SimVar.GetSimVarValue("AUTOPILOT ALTITUDE LOCK VAR", "feet")) ||
            0;
        const vsFpm = Number(SimVar.GetSimVarValue("VERTICAL SPEED", "feet per minute")) || 0;
        const gsKt = Number(SimVar.GetSimVarValue("GPS GROUND SPEED", "knots")) || 0;

        const altDiffFt = selectedAltFt - currentAltFt;

        // Need both motion and vertical trend
        if (!isFinite(altDiffFt) || !isFinite(vsFpm) || !isFinite(gsKt)) return;
        if (Math.abs(altDiffFt) < 100) return;
        if (Math.abs(vsFpm) < 100) return;
        if (gsKt < 30) return;

        // Only show if current VS is moving toward selected altitude
        if ((altDiffFt > 0 && vsFpm <= 0) || (altDiffFt < 0 && vsFpm >= 0)) return;

        // Time to selected altitude in minutes
        const timeMin = Math.abs(altDiffFt / vsFpm);

        // Distance in NM to altitude capture
        const distanceNm = gsKt * (timeMin / 60);

        if (!isFinite(distanceNm) || distanceNm <= 0) return;

        const mapRangeNm = Math.max(0.01, Number(this.visibleMapRange) || 0.01);

        // Clamp to map edge
        const clampedNm = Math.min(distanceNm, mapRangeNm);

        // Convert NM to map pixels
        const arcRadius = (clampedNm / mapRangeNm) * R;

        // Draw only if visible
        if (arcRadius < 8) return;

        // Keep visual width roughly constant in pixels
        const targetHalfWidthPx = 26;

        // chord = 2 * r * sin(theta/2)
        // so theta/2 = asin(chord/2 / r) = asin(targetHalfWidthPx / r)
        let halfSweep = Math.asin(Math.min(0.999, targetHalfWidthPx / arcRadius));

        // Clamp so it still looks like a normal banana arc
        const minHalfSweep = 0.18; // radians
        const maxHalfSweep = 0.62; // radians
        halfSweep = Math.max(minHalfSweep, Math.min(maxHalfSweep, halfSweep));

        // Center arc on straight-ahead direction (top of circle = 270deg = 1.5π)
        const centerAngle = Math.PI * 1.5;
        const start = centerAngle - halfSweep;
        const end = centerAngle + halfSweep;

        ctx.save();
        ctx.translate(cx, cy);

        ctx.strokeStyle = "#26c6ff";
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.95;
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.arc(0, 0, arcRadius, start, end, false);
        ctx.stroke();

        ctx.restore();
    }

    renderAdiPage(ctx, cx, cy, w, h, R) {
        // Fetch variables locally
        this.getAdiSimVars();

        // Draw the horizon
        this.drawHorizon(ctx);
        this.drawBank(ctx);
        this.drawSlipSkidIndicator(ctx);
        this.drawFlightDirector(ctx);
        this.drawTapeShade(ctx);
        this.drawAltitudeTape(ctx);
        this.drawVerticalSpeedIndicator(ctx, cx + 20, cy - 5, R);
        this.drawAirspeedTape(ctx);
        this.drawCurrentAltitudeBox(ctx, cx + 20, cy, R);
        this.drawCurrentAirspeedBox(ctx, cx + 75, cy, R);
        this.drawOverlay(ctx);
        //this.drawTouchHighlight(ctx);// not selectable so dissabled
        this.drawAirspeedBugBox(ctx);
        this.drawAltitudeSelectBox(ctx);
        this.drawHeadingBugBox(ctx);
        this.drawBaro(ctx);
        //this.drawMisc(ctx);
        //this.drawModeBar(ctx);
        this.drawHeadingTape(ctx);
        R = R * 0.85; // Scale down the CDI and vertical guidance to fit better with the ADI layout
        this.drawADICDI(ctx, cx, cy, R);
        this.drawVDI(ctx, cx, cy, R);
    }

    // Factor out primary page rendering logic.
    renderPrimaryPage(ctx, cx, cy, w, h) {
        const R = Math.min(w, h) * 0.43; // Precompute radius.
        this.drawCompassCard(ctx, cx, cy, R);
        this.drawRMIneedles(ctx, cx, cy, R);
        this.drawHSICourseNeedleAndCDI(ctx, cx, cy, R);
        this.drawGroundTrackLine(ctx, cx, cy);
        this.drawHSILayer2(ctx, cx, cy, R);
        this.drawNavSource(ctx, cx, cy, R);
        this.drawWaypointIdent(ctx, cx, cy, R);
        this.drawDisEte(ctx, cx, cy, R);
        this.drawVDI(ctx, cx, cy, R);
        this.drawBug(ctx, cx, cy, R);
        this.drawRMISources(ctx, cx, cy, R)
        this.drawObsText(ctx, cx, cy, R);
    }

    // Optional: remove redundant clear in renderMapPage (Update already cleared)
    renderMapPage(ctx, cx, cy, w, h) {
        const R = Math.min(w, h) * 0.43;

        this.drawNearestAirports(ctx, cx, cy, R);

        this.drawWaypoints(ctx, cx, cy, R);
        this.drawAltitudeInterceptArc(ctx, cx, cy, R);
        this.drawMapRangeRing(ctx, cx, cy, R);
        this.drawCompassCard(ctx, cx, cy, R);
        this.drawMapCourseNeedle(ctx, cx, cy, R);
        this.drawGroundTrackLine(ctx, cx, cy);
        this.drawVDI(ctx, cx, cy, R);
        this.drawHSILayer2(ctx, cx, cy, R);
        this.drawMapRangeBox(ctx);
        this.drawBug(ctx, cx, cy, R);
        this.drawMapCDI(ctx, cx, cy, R);
        this.drawCenterTrackArrow(ctx, cx, cy);

        // Debug text (optional)
        /*ctx.font = "14px Arial";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(this.airplaneLat.toFixed(2), 160, 100);*/
    }

    renderPrimaryAndMapCommon(ctx, cx, cy, w, h, R) { // <-- Added R here

        this.drawHDGTRKBox(ctx, cx, cy, R);
        this.drawCrsBox(ctx, cx, cy, R);
        this.drawHDGTRKAnnunciation(ctx);
        this.drawCenterAirplane(ctx, cx, cy);
        this.drawMiscBox(ctx); // User-selectable Misc. Field overlay (TAS/GS/OAT/Wind).
        this.drawLocCdiPrompt(ctx);//flahsed CDI when on LOC/ILS before FAF
    }

    // Factor out rendering for common visual elements.
    renderCommonElements(ctx, w, h, cx, cy, R) {
        const doDebug = false; // Set to true to enable debug text overlay.

        this.drawOptions(ctx);
        this.drawBezel(ctx, w, h);
        this.drawTouchBoxes(ctx, doDebug); // Optional: Highlight interactive boxes. 
        this.drawPagingDots(ctx);
        if (doDebug) this.drawDebugText(ctx);
    }

    drawDimOverlay(ctx, w, h, brightness) {
        // brightness: 0..1 where 1 = full bright, 0 = black
        brightness = Math.max(0, Math.min(1, brightness));
        const dim = 1 - brightness;

        if (dim <= 0) return;

        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${dim})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
    }

    // Update function
    Update() {

        this.updatePowerState();

        if (!this.mfdPowered && !this.shutdownActive && !this.initScreenActive && !this.stayOnOverride) {
            const ctx = this.canvas.getContext("2d");
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            return;
        }

        this.getSimVars();
        this.followTRK();

        const canvas = this.canvas || (this.canvas = document.getElementById("mfdCanvas"));
        if (!canvas) return;

        // Use an alpha-enabled context
        const ctx = this.canvasCacheContext || (this.canvasCacheContext = canvas.getContext("2d", { alpha: true }));
        const { width: w, height: h } = canvas;
        const cx = w / 2, cy = h / 2;

        // Clear to transparent so underlying gauges remain visible
        ctx.clearRect(0, 0, w, h);

        // initialize screen
        if (this.initScreenActive) {
            this.drawInitScreen(ctx);
            return;
        }

        // shutdown screen
        if (this.shutdownComplete) {
            ctx.save();
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
            return;
        }

        // normal drawing
        // Paint an opaque black background on primary and ADI pages
        if (this.currentPage === "primary" || this.currentPage === "adi") {
            ctx.save();
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }

        const R = Math.min(w, h) * 0.43;

        // Route to the correct page renderer
        if (this.currentPage === "primary") {
            this.renderPrimaryPage(ctx, cx, cy, w, h);
            this.renderPrimaryAndMapCommon(ctx, cx, cy, w, h, R);
        } else if (this.currentPage === "map") {
            this.renderMapPage(ctx, cx, cy, w, h);
            this.renderPrimaryAndMapCommon(ctx, cx, cy, w, h, R);
        } else if (this.currentPage === "adi") {
            this.renderAdiPage(ctx, cx, cy, w, h, R);
        }

        this.renderCommonElements(ctx, w, h, cx, cy, R);
        this.drawShutdownOverlay(ctx);
        const effectiveBrightness = Math.max(0, Math.min(1, this.screenBrightness - this.MFD_dimming));
        this.drawDimOverlay(ctx, this.canvas.width, this.canvas.height, effectiveBrightness);
    }
}

if (typeof registerInstrument === "function") {
    registerInstrument("custom-mfd-gauge", MFD_screen);
}