// PFD_screen.js with PMS50 APGA integration, MSFS instrument methods preserved
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




class PFD_screen extends (typeof BaseInstrument !== "undefined" ? BaseInstrument : class { }) {
    constructor() {
        super();

        this.knobLongPressFired = false;
        this.engineRunning = 0
        this.isForcedStalled = false; // Add this for the custom lean misfire logic
        //--- Flight variables

        SimVar.SetSimVarValue("L:cabin_light_red", "bool", 0);

        this.PFD_dimming = Number(SimVar.GetSimVarValue("L:PFD_Dim.1", "Number")); // 0.0 to 0.3, subtracts from auto brightness
        this.baroSyncDone = false;
        this.baroSyncTries = 0;

        // DH knob multiplier - fixed window count (simple + stable)
        this._dhSpin = {
            windowMs: 150,     // timer interval (tune 150-250ms)
            stepsThisWindow: 0,
            stepsLastWindow: 0,
            intervalId: null
        };

        this.trimCue = ""; // "", "TRIM UP", "TRIM DOWN"

        // Flight director display smoothing
        this.fdPitchSmooth = 0;
        this.fdBankSmooth = 0;
        this.fdSmoothingInitialized = false;
        this.fdSmoothFactor = 0.18; // 0..1, lower = smoother, higher = more responsive

        // Smoothed wind display state
        this.windSampleIntervalMs = 500;     // sample twice per second
        this.windAverageWindowMs = 15000;    // 15-second average
        this.windSamples = [];               // [{ t, dir, spd }]
        this.windDisplayDirection = 0;
        this.windDisplaySpeed = 0;
        this._lastWindSampleMs = 0;

        this.tawsTestDelayMs = 30000;
        this.tawsTestStartMs = 0;
        this.tawsTestPending = false;
        this.tawsTestPlayed = false;

        this.powerUpDelayMs = 10000;
        this.powerUpStartMs = 0;
        this.powerUpActive = false;
        this.wasPowered = false;
        this.avionicsON = true;

        this.baroMode = 0; // 0 = IN, 1 = HPA
        this.lightBlue = "#26c6ff";
        this.magenta = "#ff00ff";
        this.light_timer = 0;

        this.debugCnt = 0;
        this.ALT_prevent_counter = 0;
        this.ALT_prevent_max = 50; // number of times to prevent ALT capture after spinning ALT SEL
        this.prev_ALTbug = 0;

        // --- preview CDI/VDI ---
        this.isPreviewActive = false;       // True if a valid preview source is found
        this.previewCdiDeflection = 0;      // The CDI deflection for the preview
        this.previewVdiDeflection = 0;      // The VDI deflection for the preview
        this.previewVtgValid = false;       // True if the preview source has a valid GS
        this.previewToFrom = 0;             // The TO/FROM flag for the preview

        // --- Options menu state (PFD) ---
        this.showOptions = false;
        this.optionsSel = 1;     // 0 is Back, 1..N are menu items
        this.optionsLevel = 0;   // 0 = root, 1 = child
        this.optionsParent = ""; // which root category we are in
        this.optionsEditing = false;
        this.optionsEditKey = "";
        this.lastSmallKnobTime = 0;
        //CDI/VDI
        this.cdiVdiPreviewOn = false;
        this.courseDevs = false;
        this.navSourceCode = 0;
        this.cdiDeflection = 0;
        this.vdiDeflection = 0;
        this.phaseText = "";
        this.selectedNavSource = "";      // text label derived from navSourceCode
        this.navSourceText = "";      // text label for display (e.g., "GPS", "VOR1", "VOR2")
        this.identColor = "#e049b0";  // magenta for GPS; used by drawMapCDI
        this.toFromFlag = 1; // 0=OFF, 1=TO, 2=FROM (PFD-local)
        this.course = 0;
        this.navAvail = false; // true when CDI deflection is valid for display (e.g., GPS has signal, VOR has signal, etc.)

        // Vertical guidance state for VDI (fed by MFD L:vars)
        this.vtgValid = false;        // true when GS/GP/VNAV signal is valid
        this.vtgType = "";            // "GS" | "GP" | "VNAV" | ""

        // Minimums (not persistent)
        this.minimumsDh = 0;

        this.vSpeedShow = {
            Vr: true,
            Vx: true,
            Vy: true,
            Vg: true
        };
        this.minimumsBugOn = false; // ON/OFF for drawing minimums bug

        this.optionsRoot = [
            "MSG",
            "Options",
            "D->",
            "System",
            "Backlight",
            "Units",
            "DB",
            "Setup",
            "Crew Profiles",
            "Info."
        ];

        this.optionsChildren = {
            "Options": ["NAV Options", "Airspeeds", "Minimums", "Misc. Field", "ESP", "Overlay Meters"],
            "Airspeeds": ["All On", "All Off", "Vr", "Vx", "Vy", "GLIDE"],
            "Misc. Field": ["Off", "TAS", "GS", "OAT", "Temp Settings", "Wind", "Wind Settings", "G Meter"],
            "Wind Settings": ["<-MPH ^MPH", "DEG MPH", "<- MPH"],
            "NAV Options": ["CDI", "CRS Devs", "CRS Options", "HDG Options", "CDI/VDI Preview"],
            "CRS Options": ["CRS"],
            "HDG Options": ["HDG"],
            "Minimums": ["Minimums Bug", "Altitude"],
            "Units": ["BARO", "Angle", "Temp"],
            "Backlight": ["Brighter", "Dimmer"],
        };

        this.menuHistory = []; // Stores previous menus for deep navigation

        // How to initialize and use the timer variable
        this.ALT_timer = new Timer(10); // Initialize with a 10-second duration
        this.lastPitchMode = "";
        this.lastVS = 0;

        // AP/FD button states for go around
        this.GA_timer = 0;
        this.GA_button = false;
        this.navSuspended = false;
        this.RA = 0;

        this.taws500Armed = false;

        this.flightCounter = 0;
        this.isOnGround = true;
        this.knobLongPressTimer = null;
        this.knobLongPressFired = false;
        this.engineRunning = 0
        //--- Flight variables
        this.pitch = 0;
        this.bank = 0;
        this.baro = 29.92;
        this.alt = 0;
        this.altitudeBug = 0; // PMS50 APGA selected altitude
        this.heading = 0;
        this.headingBug = 0;
        // last remembered HDG bug when not in TRK mode
        this.prevHDGsel = 0;
        this.prevTrkHold = false;
        this.ias = 0;
        this.airspeedBug = 0;
        this.yaw_slip = 0;
        this.trkHold = false;
        this.trkSel = 0;
        this.fdActive = false;
        this.fdPitch = 0;
        this.fdBank = 0;
        this.oat = 15;
        this.TAS = 0;
        this.GS = 0;
        this.Vso = 55;
        this.Vfe = 100;
        this.Vs = 64;
        this.Vno = 160;
        this.redMax = 184;
        this.Vr = 60;
        this.Vx = 70;
        this.Vy = 90;
        this.Vg = 90;
        // AP/FD modes
        this.lateralMode = "";
        this.armedLateralMode = "";
        this.autopilotMode = "";
        this.pitchMode = "";
        this.armedPitchMode = "";
        this.apVS = 0;
        this.gaMode = false;

        //--- Alert system
        this.altAlertType = 0;
        this.altAlertLast = 0;
        this.altAlertFlash = false;
        this.altAlertReset = true;
        this.altAlertCount = 0;

        //--- Image srcs
        this.bezelImgSrc = "Gi-275_attitude_bezel.png";
        this.fdImgSrc = "Gi-275_attitude_FD.png";
        this.horizonNumbersImgSrc = "horizonnumbers.png";
        this.horizonImgSrc = "horizonbackground.png";
        this.bank_angleImgSrc = "bank_angle.png";
        this.overlayImgSrc = "Gi-275_attitude_overlay.png";
        this.tapeShadeImgSrc = "Gi-275_attitude_tape_shade.png";
        this.altBugImgSrc = "Gi-275_bug.png";
        this.altAlertImgSrc = "Gi-275_attitude_alt_alert.png";
        this.touchHighlightImgSrcs = [
            "Gi-275_attitude_overlay_spd.png",
            "Gi-275_attitude_overlay_alt.png",
            "Gi-275_attitude_overlay_baro.png",
            "Gi-275_attitude_overlay_hdg.png"
        ];

        this.images = {};
        this.touchHighlightImgs = [];

        // options buttons size/location (match MFD)
        const bx = 60;
        const by = 205;
        const bw = 65;
        const bh = 60;
        const pad = 2;

        this.touchBoxes = [
            { id: "spd", x: 0, y: 65, w: 85, h: 20 },
            { id: "alt", x: 220, y: 65, w: 85, h: 20 },
            { id: "baro", x: 235, y: 208, w: 80, h: 20 },
            { id: "hdg", x: 0, y: 208, w: 80, h: 20 },
            // Large knob
            { id: "large_knob_cw", x: 0, y: 265, w: 20, h: 40 },//4
            { id: "large_knob_ccw", x: 50, y: 265, w: 20, h: 40 },//5
            // Small knob
            { id: "small_knob_cw", x: 20, y: 265, w: 30, h: 10 },//6
            { id: "small_knob_ccw", x: 20, y: 295, w: 30, h: 10 },//7
            // Small knob button
            { id: "small_knob_button", x: 25, y: 280, w: 18, h: 10 },//8


            // --- options touchboxes (3 buttons) ---
            { id: "options_back", x: 62, y: 35, w: 65, h: 55 },
            { id: "options_btn_1", x: 60, y: 205, w: 65, h: 60 },
            { id: "options_btn_2", x: 60 + 65 + 2, y: 205, w: 65, h: 60 },
            { id: "options_btn_3", x: 60 + 2 * (65 + 2), y: 205, w: 65, h: 60 },
            { id: "options_btn_4", x: 60 + 3 * (65 + 2), y: 205, w: 65, h: 60 },
        ];
        this.touchSelected = 3;
        this.canvas = null;
        this.lastInteractionTime = Date.now();

        this._defaultTouchBoxes = JSON.parse(JSON.stringify(this.touchBoxes));
        this._inMiscLayout = false;

        const master = SimVar.GetSimVarValue("ELECTRICAL MASTER BATTERY", "Bool");
        SimVar.SetSimVarValue("L:EIS_Battery_Switch", "Number", master);
    }

    getSimVars() {
        if (typeof SimVar !== "undefined" && typeof SimVar.GetSimVarValue === "function") {

            // EIS battery voltage display: 0=blank, 1=12V, 2=14V
            const eisBatt = SimVar.GetSimVarValue("L:EIS_Battery_Switch", "Bool");

            // Check the actual voltage on the main bus (bus.1)
            const mainBusVoltage = SimVar.GetSimVarValue("ELECTRICAL MAIN BUS VOLTAGE:1", "Volts");

            let mode = 0;

            if (eisBatt) {
                const has14V = mainBusVoltage >= 13.9;
                mode = has14V ? 2 : 1;
            }

            SimVar.SetSimVarValue("L:EIS_volts_display", "Number", mode);

            let PA = SimVar.GetSimVarValue("PRESSURE ALTITUDE", "feet") || 0;// this is a bit off for some reason
            this.alt = PA - ((29.92 - this.baro) * 1000);
            this.pitch = SimVar.GetSimVarValue("PLANE PITCH DEGREES", "degrees");
            this.bank = SimVar.GetSimVarValue("PLANE BANK DEGREES", "degrees");
            this.heading = SimVar.GetSimVarValue("PLANE HEADING DEGREES MAGNETIC", "degrees") || 0;
            this.trueCourse = SimVar.GetSimVarValue("PLANE HEADING DEGREES TRUE", "degrees") || 0;
            this.magVar = SimVar.GetSimVarValue("MAGVAR", "degrees") || 0;
            this.ias = Number(((SimVar.GetSimVarValue("AIRSPEED INDICATED", "Knots") || 0) * 1.15078).toFixed(1));
            this.VS = SimVar.GetSimVarValue("VERTICAL SPEED", "Feet per minute");
            this.headingBug = SimVar.GetSimVarValue("AUTOPILOT HEADING LOCK DIR:1", "degrees") || 0;
            this.airspeedBug = Math.round((SimVar.GetSimVarValue("AUTOPILOT AIRSPEED HOLD VAR", "Knots") || 0) * 1.15078);
            this.prev_ALTbug = this.altitudeBug;
            this.altitudeBug = SimVar.GetSimVarValue("L:PMS50_APGA_SELECTED_ALTITUDE", "feet") || 0;
            this.groundSpeed = Number(((SimVar.GetSimVarValue("GPS GROUND SPEED", "knots") || 0) * 1.15078).toFixed(1));
            this.TAS = Number(((SimVar.GetSimVarValue("AIRSPEED TRUE", "knots") || 0) * 1.15078).toFixed(1));
            this.oat = SimVar.GetSimVarValue("AMBIENT TEMPERATURE", "fahrenheit");
            this.gs = Number(((SimVar.GetSimVarValue("GPS GROUND SPEED", "knots") || 0) * 1.15078).toFixed(1));//MPH

            // Keep avionics state if you still use it elsewhere for radios/features
            this.avionicsON = SimVar.GetSimVarValue("CIRCUIT AVIONICS ON", "Boolean") === 1;

            // PFD should be powered when bus 1 has voltage
            const pfdBreakerOn = SimVar.GetSimVarValue("L:CB_PFD", "Bool") === 1;
            this.pfdPowered = SimVar.GetSimVarValue("ELECTRICAL MAIN BUS VOLTAGE:1", "Volts") && pfdBreakerOn;
            SimVar.SetSimVarValue("L:PFD_powered", "Number", this.pfdPowered ? 1 : 0);
            this.updatePowerUpState();
            this.syncBaroOnStartup();

            const baroUnitsVar = SimVar.GetSimVarValue("L:PFD_BARO_UNITS", "number");
            if (baroUnitsVar === 1) this.baroUnits = "HPA";
            else this.baroUnits = "IN";

            this.initLights();//turn lights on at dark
            this.cabinLightRedWhite();

            // --- PFD-local nav source selection (DECOUPLED FROM MFD) ---
            // Try L:PFD_NavSrc.1 first: 0=GPS, 1=VOR1, 2=VOR2
            const pfdNavSel = SimVar.GetSimVarValue("L:PFD_NavSrc.1", "Number");

            if (pfdNavSel === 0) {
                this.selectedNavSource = "GPS";
                this.navSourceText = "GPS";
                this.navAvail = true;
            } else if (pfdNavSel === 1) {
                this.selectedNavSource = "NAV1";
                const locAvailable = !!SimVar.GetSimVarValue("NAV HAS LOCALIZER:1", "Bool");
                const gsAvailable = !!SimVar.GetSimVarValue("NAV HAS GLIDE SLOPE:1", "Bool");
                this.navSourceText = locAvailable && gsAvailable ? "ILS1"
                    : locAvailable && !gsAvailable ? "LOC1" : "VOR1";
                this.navAvail = !!SimVar.GetSimVarValue("NAV SIGNAL:1", "Bool");
            } else if (pfdNavSel === 2) {
                this.selectedNavSource = "NAV2";
                const locAvailable = !!SimVar.GetSimVarValue("NAV HAS LOCALIZER:2", "Bool");
                const gsAvailable = !!SimVar.GetSimVarValue("NAV HAS GLIDE SLOPE:2", "Bool");
                this.navSourceText = locAvailable && gsAvailable ? "ILS2"
                    : locAvailable && !gsAvailable ? "LOC2" : "VOR2";
                this.navAvail = !!SimVar.GetSimVarValue("NAV SIGNAL:2", "Bool");
            } else {
                // Fallback to aircraft state if L:PFD_NavSrc.1 is not set
                const gpsDrivesNav1 = !!SimVar.GetSimVarValue("GPS DRIVES NAV1", "Bool");
                this.selectedNavSource = gpsDrivesNav1 ? "GPS" : "NAV1";
            }

            this.course = this.getSelectedCourse(this.selectedNavSource);

            // --- CDI deflection + TO/FROM by source ---
            if (this.selectedNavSource === "GPS") {
                // GPS always shows TO, and GPS CDI NEEDLE provides the deflection
                this.cdiDeflection = Number(SimVar.GetSimVarValue("GPS CDI NEEDLE", "Number")) || 0;
                this.toFromFlag = 1; // GPS CDI is TO
            } else if (this.selectedNavSource === "NAV1") {
                this.cdiDeflection = Number(SimVar.GetSimVarValue("NAV CDI:1", "Number")) || 0;
                this.toFromFlag = Number(SimVar.GetSimVarValue("NAV TOFROM:1", "Number")) || 0;
            } else if (this.selectedNavSource === "NAV2") {
                this.cdiDeflection = Number(SimVar.GetSimVarValue("NAV CDI:2", "Number")) || 0;
                this.toFromFlag = Number(SimVar.GetSimVarValue("NAV TOFROM:2", "Number")) || 0;
            } else {
                this.cdiDeflection = 0;
                this.toFromFlag = 0;
            }

            // --- Vertical guidance type + deflection ---
            const hasGP = !!SimVar.GetSimVarValue("GPS HAS GLIDEPATH", "Bool");
            const gs1 = !!SimVar.GetSimVarValue("NAV HAS GLIDE SLOPE:1", "Bool");
            const gs2 = !!SimVar.GetSimVarValue("NAV HAS GLIDE SLOPE:2", "Bool");

            if (this.selectedNavSource === "GPS" && hasGP) {
                this.vtgType = "GP";
                this.vtgValid = true;
                this.vdiDeflection = Number(SimVar.GetSimVarValue("GPS GSI NEEDLE", "Number")) || 0;
            } else if (this.selectedNavSource === "NAV1" && gs1) {
                this.vtgType = "GS";
                this.vtgValid = true;
                this.vdiDeflection = Number(SimVar.GetSimVarValue("NAV GSI:1", "Number")) || 0;
            } else if (this.selectedNavSource === "NAV2" && gs2) {
                this.vtgType = "GS";
                this.vtgValid = true;
                this.vdiDeflection = Number(SimVar.GetSimVarValue("NAV GSI:2", "Number")) || 0;
            } else {
                this.vtgType = "";
                this.vtgValid = false;
            }

            // --- Phase label ---
            // GPS: use the Garmin L:var like your MFD; VORs fall back to ENR/APR based on LOC/GS availability
            const phaseIdx = SimVar.GetSimVarValue("L:WTGarmin_LNavData_CDI_Scale_Label", "number");
            if (this.selectedNavSource === "GPS") {
                this.phaseText = this.getFlightPhaseLabel((phaseIdx !== undefined && phaseIdx !== null) ? phaseIdx : -1);
            } else {
                const locAvail = (this.selectedNavSource === "NAV1")
                    ? !!SimVar.GetSimVarValue("NAV HAS LOCALIZER:1", "Bool")
                    : !!SimVar.GetSimVarValue("NAV HAS LOCALIZER:2", "Bool");
                const gsAvail = (this.selectedNavSource === "NAV1") ? gs1 : gs2;
                this.phaseText = (locAvail || gsAvail) ? "APR" : "ENR";
            }

            this.cdiVdiPreviewOn = SimVar.GetSimVarValue("L:PFD_NavPrev.1", "Number");
            this.courseDevs = SimVar.GetSimVarValue("L:PFD_CrsDevs.1", "Number") || 0;

            // --- CDI/VDI Preview Logic ---
            this.isPreviewActive = false; // Reset on each update cycle

            // Only run preview logic if the feature is ON and GPS is the active source.
            if (this.cdiVdiPreviewOn && this.selectedNavSource === "GPS") {
                const nav1Signal = !!SimVar.GetSimVarValue("NAV SIGNAL:1", "Bool");
                const nav2Signal = !!SimVar.GetSimVarValue("NAV SIGNAL:2", "Bool");
                let previewSource = null;

                // Prefer NAV1 if it has a signal, otherwise check NAV2.
                if (nav1Signal) {
                    previewSource = "NAV1";
                } else if (nav2Signal) {
                    previewSource = "NAV2";
                }

                if (previewSource) {
                    this.isPreviewActive = true;
                    const navIndex = (previewSource === "NAV1") ? 1 : 2;

                    // Get data for the selected preview source
                    this.previewCdiDeflection = SimVar.GetSimVarValue(`NAV CDI:${navIndex}`, "Number") || 0;
                    this.previewToFrom = SimVar.GetSimVarValue(`NAV TOFROM:${navIndex}`, "Number") || 0;

                    // Check for a valid Glideslope for the VDI preview
                    const hasGs = !!SimVar.GetSimVarValue(`NAV HAS GLIDE SLOPE:${navIndex}`, "Bool");
                    if (hasGs) {
                        this.previewVtgValid = true;
                        this.previewVdiDeflection = SimVar.GetSimVarValue(`NAV GSI:${navIndex}`, "Number") || 0;
                    } else {
                        this.previewVtgValid = false;
                    }
                }
            }


            this.miscOption = SimVar.GetSimVarValue("L:PFD_Misc.1", "number") || 0;
            this.windOption = SimVar.GetSimVarValue("L:PFD_Wind_Style.1", "number") || 0; // 0: <-MPH ^MPH, 1: DEG MPH, 2: \MPH
            this.updateSmoothedWind();
            this.windDirection = this.windDisplayDirection || 0;
            this.windSpeed = this.windDisplaySpeed || 0;

            this.updateTakeoffWindow();//used for TAWS audio
            this.yaw_slip = SimVar.GetSimVarValue("TURN COORDINATOR BALL", "position");

            // TAWS dest distance
            let distM = SimVar.GetSimVarValue("L:WT_LNavData_Destination_Distance", "Number");
            // "Has destination" heuristic
            const hasDest = (typeof distM === "number" && isFinite(distM) && distM > 0);
            // Expose flags for sound gating
            SimVar.SetSimVarValue("L:TAWS_HAS_DEST", "Number", hasDest ? 1 : 0);

            // Keep DEST_DIST for other uses, but DON'T fake it to 100nm when invalid.
            // If you still need a numeric value elsewhere, set 0 when invalid.
            if (!hasDest) distM = 0;
            const distNm = distM / 1852;

            SimVar.SetSimVarValue("L:DEST_DIST", "Number", distNm);


            // Brightness
            let potValue = SimVar.GetSimVarValue("LIGHT POTENTIOMETER:3", "Number");
            let screenBrightness = (potValue === 0) ? 1.0 : 0.4;
            this.screenBrightness = screenBrightness;
            SimVar.SetSimVarValue("L:SCREEN_BRIGHT", "Number", screenBrightness);


            // AP/FD state (PMS50)
            this.fdActive = !!SimVar.GetSimVarValue("L:PMS50_APGA_FD_BUTTON_STATE", "Bool");
            if (!this.fdActive) {
                this.fdSmoothingInitialized = false;
            }
            this.gaMode = !!SimVar.GetSimVarValue("L:PMS50_APGA_GA_BUTTON_STATE", "Bool");
            this.autopilotMode = (
                !!SimVar.GetSimVarValue("L:PMS50_APGA_AP_BUTTON_STATE", "Bool")
                    ? "AP"
                    : (this.fdActive ? "FD" : "")
            );
            this.capturedAltitude = SimVar.GetSimVarValue("L:PMS50_APGA_CAPTURED_ALTITUDE", "feet") || 0;
            this.capturedAltitudeValid = !!SimVar.GetSimVarValue("L:PMS50_APGA_CAPTURED_ALTITUDE_VALID", "Bool");

            this.updateTrimAdvisory();

            // Flight Director bars
            const fdPitchRad = SimVar.GetSimVarValue("AUTOPILOT FLIGHT DIRECTOR PITCH", "radians") || 0;
            const fdBankRad = SimVar.GetSimVarValue("AUTOPILOT FLIGHT DIRECTOR BANK", "radians") || 0;
            this.fdPitch = fdPitchRad * (180 / Math.PI);
            this.fdBank = fdBankRad * (180 / Math.PI);
            this.updateSmoothedFlightDirector();
            // Track Mode
            this.trkHold = !!SimVar.GetSimVarValue("L:TRK_HOLD", "Bool");
            this.trkSel = SimVar.GetSimVarValue("L:TRK_SEL", "number") || 0;
            // Detect leaving TRK mode (TRK->HDG)
            if (this.prevTrkHold && !this.trkHold) {
                const restore = (Number(this.prevHDGsel) + 360) % 360;

                // push it back to the sim so HDG bug doesn't jump to 000
                if (typeof SimVar !== "undefined") {
                    SimVar.SetSimVarValue("K:HEADING_BUG_SET", "degrees", Math.round(restore));
                }

                // keep your local variables coherent too
                this.headingBug = restore;
                this.hdgSel = restore;
            }

            this.prevTrkHold = !!this.trkHold;
            // Remember the last valid HDG bug while we're in HDG mode
            if (!this.trkHold) this.prevHDGsel = (this.headingBug + 360) % 360;

            // PMS50 Mode Detection via LVars (numeric)
            const activeLatMode = SimVar.GetSimVarValue("L:PMS50_APGA_ACTIVE_LATERAL_MODE", "Number") || 0;
            const activeVertMode = SimVar.GetSimVarValue("L:PMS50_APGA_ACTIVE_VERTICAL_MODE", "Number") || 0;// 0:NONE, 1:PITCH, 2:VS, 3:ALT, 4:GS, 5:GP, 6:FLC, 7:VNAV, 8:CGA, 9:CLVL
            const armedLatMode = SimVar.GetSimVarValue("L:PMS50_APGA_ARMED_LATERAL_MODE", "Number") || 0;
            const armedVertMode = SimVar.GetSimVarValue("L:PMS50_APGA_ARMED_VERTICAL_MODE", "Number") || 0;
            const selectedAltPhase = SimVar.GetSimVarValue("L:PMS50_APGA_SELECTED_ALTITUDE_PHASE", "Number") || 0;

            const lastPitchMode = this.pitchMode;
            this.lastVS = SimVar.GetSimVarValue("L:PMS50_APGA_SELECTED_VS", "Number") || 0;

            // Display PMS50 Mode Annunciation using class utility methods
            this.lateralMode = this.latModeName(activeLatMode);
            this.armedLateralMode = this.latModeName(armedLatMode);
            this.pitchMode = this.vertModeName(activeVertMode);
            this.armedPitchMode = this.vertModeName(armedVertMode);

            // --- If ALT captured while pilot is spinning ALT SEL, revert to prior vertical mode ---
            if (this.prev_ALTbug !== this.altitudeBug) {
                this.ALT_prevent_counter = 0; // reset counter on any ALT bug change
            } else if (this.ALT_prevent_counter < 1000) {
                this.ALT_prevent_counter++;
            }
            let inhibiting = false;
            if (this.ALT_prevent_counter < this.ALT_prevent_max) inhibiting = true;


            SimVar.SetSimVarValue("L:dbg_counter", "number", this.ALT_prevent_counter);
            SimVar.SetSimVarValue("L:dbg_inhibiting", "number", inhibiting ? 1 : 0);


            if (inhibiting && this.pitchMode === "ALT") {
                if (lastPitchMode === "VS") {
                    SimVar.SetSimVarValue("L:vs_set_during_alt_capture", "number", 1);


                    SimVar.SetSimVarValue("H:PMS50_APGA_AP_VS", "number", 1);
                    //SimVar.SetSimVarValue("K:AP_VS_ON", "number", 0);
                    //SimVar.SetSimVarValue("K:AP_VS_VAR_SET_ENGLISH", "number", this.lastVS);
                } else if (lastPitchMode === "IAS") {
                    // Your "IAS" annunciation corresponds to PMS50 FLC
                    SimVar.SetSimVarValue("H:PMS50_APGA_AP_FLC", "number", 1);
                } else if (lastPitchMode === "VNAV") {
                    SimVar.SetSimVarValue("H:PMS50_APGA_AP_VNAV", "number", 1);
                }
            }

            // hack to override GP ...
            const apr_button = SimVar.GetSimVarValue("L:PMS50_APGA_APR_BUTTON_STATE", "Number");
            this.GPS_has_GP = SimVar.GetSimVarValue("GPS HAS GLIDEPATH", "Bool");
            const vnav_button = SimVar.GetSimVarValue("L:PMS50_APGA_VNAV_BUTTON_STATE", "Number");
            const isGpActive = (Number(SimVar.GetSimVarValue("L:PMS50_AUTOPILOT_VERTICAL_ACTIVE", "number")) === 6);

            // IMPORTANT: use "feet" not "Feet"
            const nextConstraintAlt = Number(
                SimVar.GetSimVarValue("L:PMS50_AUTOPILOT_VNAV_CURRENT_CONSTRAINT_ALTITUDE", "feet")
            );

            const dist = Number(SimVar.GetSimVarValue("L:DEST_DIST", "number")) || 0;
            const closeInForGp = (dist > 0 && dist < 8);

            // Decide which is next (ALT vs VNAV). Only meaningful if VNAV button selected.
            let nextArmed = "ALT";
            if (vnav_button) {
                nextArmed = this.getNextRestrictiveArmedMode(this.altitudeBug, nextConstraintAlt, this.alt);
            }

            if (this.GPS_has_GP && apr_button && this.pitchMode !== "GP") {
                if (isGpActive) {
                    // GP actually active/captured -> OK to force active mode display
                    this.pitchMode = "GP";
                } else if (closeInForGp) {
                    // Only close-in do we force GP armed
                    this.armedPitchMode = "GP";
                } else if (this.pitchMode === "VNAV" && this.armedPitchMode === "") {
                    this.armedPitchMode = "GP";
                } else {
                    // FAR OUT + APR pressed: allow ALT/VNAV-next to show
                    if (
                        vnav_button &&
                        this.pitchMode !== "VNAV" &&
                        this.pitchMode !== "ALT" &&
                        this.lateralMode === "GPS" &&
                        (nextArmed === "VNAV" || nextArmed === "ALT")
                    ) {
                        // VNAV button pressed: append "/V" to the existing armed pitch
                        // mode (e.g. GP -> GP/V); fall back to the next probable mode
                        // (VNAV/ALT) when nothing else is armed.
                        this.armedPitchMode = this.armedPitchMode
                            ? this.armedPitchMode + "/V"
                            : nextArmed;
                    }
                    // else: don't change armedPitchMode here
                }
            } else if (
                vnav_button &&
                this.pitchMode !== "VNAV" &&
                this.pitchMode !== "ALT" &&
                this.lateralMode === "GPS"
            ) {
                // VNAV button pressed: show what will capture next
                if (nextArmed === "VNAV" || nextArmed === "ALT") {
                    // Append "/V" to the existing armed pitch mode (e.g. GP -> GP/V);
                    // fall back to the next probable mode (VNAV/ALT) when nothing
                    // else is armed.
                    this.armedPitchMode = this.armedPitchMode
                        ? this.armedPitchMode + "/V"
                        : nextArmed;
                }
            }


            // ALT blink timer
            // CHANGE DETECTION: If it WASN'T ALT before, but it IS now:
            if (lastPitchMode !== "ALT" && this.pitchMode === "ALT") {
                this.ALT_timer.start();
            }

            // If we leave ALT mode entirely, stop the timer just in case
            if (this.pitchMode !== "ALT") {
                this.ALT_timer.stop();
            }

            //TRK hold indicator, override HDG mode display if TRK_SEL is true
            if (this.trkHold && this.lateralMode === "HDG") {
                this.lateralMode = "TRK";
            }

            // For display: selected altitude phase, armed indicators
            this.altArmActive = [1, 2, 3].includes(selectedAltPhase);
            this.gsCoupled = activeVertMode === 4 || activeVertMode === 5;    // GS or GP
            this.trimWarn = !!SimVar.GetSimVarValue("L:PMS50_APGA_NEED_TRIM_INDICATOR", "Bool");

            // VS/IAS Bug (PMS50 LVar)
            this.apVS = SimVar.GetSimVarValue("L:PMS50_APGA_SELECTED_VS", "feet/minute") || 0;

            // Altitude Lock for vertical modes
            if (
                this.pitchMode === "VS" ||
                this.pitchMode === "FLC" ||
                this.pitchMode === "VNAV"
            ) {
                SimVar.SetSimVarValue("AUTOPILOT ALTITUDE LOCK VAR", "feet", this.altSel);
                this.altLock = this.altSel;
            }

            // --- TRK override: if TRK hold is active, force mode indication and bug display ---
            if (this.trkHold && this.activeLatMode === 0) {
                this.lateralMode = "TRK";
                this.headingBug = this.trkSel;
            } else {

            }

            // If GPS just became active, turn off heading/roll lock/track lock
            if (
                this.activeLatMode === 3 // 3 = GPS in PMS50/APGA mode table
                && (this.hdgLock || this.rollLock)
            ) {
                // Deselect HDG/ROL/TRK
                SimVar.SetSimVarValue("K:AP_HDG_HOLD_OFF", "number", 0);
                SimVar.SetSimVarValue("K:AP_BANK_HOLD_OFF", "number", 0);
                SimVar.SetSimVarValue("L:TRK_SEL", "number", 0);
            }

            const vr = SimVar.GetSimVarValue("L:Vr.1", "number");
            if (Number.isFinite(vr)) this.Vr = vr;

            const vx = SimVar.GetSimVarValue("L:Vx.1", "number");
            if (Number.isFinite(vx)) this.Vx = vx;

            const vy = SimVar.GetSimVarValue("L:Vy.1", "number");
            if (Number.isFinite(vy)) this.Vy = vy;

            const vg = SimVar.GetSimVarValue("L:Vg.1", "number");
            if (Number.isFinite(vg)) this.Vg = vg;

            const dh = SimVar.GetSimVarValue("L:PFD_MINIMUMS_DH", "number");
            if (Number.isFinite(dh)) this.minimumsDh = dh;

            if (this.alt <= this.minimumsDh) {
                SimVar.SetSimVarValue("L:MINIMUMS", "number", 1);//at or below minimums
            } else {
                SimVar.SetSimVarValue("L:MINIMUMS", "number", 0);
            }

            if (this.lateralMode === "GA") {
                this.GA_button = true;
            }

            this.RA = SimVar.GetSimVarValue("PLANE ALT ABOVE GROUND", "feet");
            this.navSuspended = !!SimVar.GetSimVarValue("L:WTAP_LNav_Is_Suspended", "Number");

            // --- 500 FT CALLOUT LOGIC ---
            // 1. Arm the callout if on the ground or above 2500ft AGL
            if (this.isOnGround || this.RA > 2500) {
                this.taws500Armed = true;
                SimVar.SetSimVarValue("L:PLAY_500_CALLOUT", "Number", 0);
            }

            // 2. Trigger the callout if armed, in range, and descending
            if (this.taws500Armed && this.RA <= 500 && this.RA >= 400 && this.VS < -10) {
                SimVar.SetSimVarValue("L:PLAY_500_CALLOUT", "Number", 1);
                this.taws500Armed = false; // Instantly disarm so it cannot play again
            }

            // Custom Lean Misfire logic
            this.manageEngineStall();
        }
    }

    manageEngineStall() {
        if (typeof SimVar === "undefined") return;

        let fuelFlow = SimVar.GetSimVarValue("ENG FUEL FLOW GPH:1", "gallons per hour");
        let mp = SimVar.GetSimVarValue("ENG MANIFOLD PRESSURE:1", "inHg");
        let rpm = SimVar.GetSimVarValue("GENERAL ENG RPM:1", "rpm");
        let currentMix = SimVar.GetSimVarValue("GENERAL ENG MIXTURE LEVER POSITION:1", "percent");

        if (rpm < 1000) {
            if (this.isForcedStalled) {
                SimVar.SetSimVarValue("K:MAGNETO1_SET", "number", 3); // 3 = BOTH
                this.isForcedStalled = false;
            }
            return;
        }

        // NEW: If mixture lever is over 50%, the engine is rich enough to always run.
        // Instantly recover if stalled, and skip the lean-misfire math entirely.
        if (currentMix > 50) {
            if (this.isForcedStalled) {
                SimVar.SetSimVarValue("K:MAGNETO1_SET", "number", 3);
                this.isForcedStalled = false;
            }
            return;
        }

        let expectedFF = (mp * rpm) / 3900;

        // Dynamic Misfire Threshold
        let thresholdFactor = 0.5;
        if (mp < 18) {
            thresholdFactor = (mp / 36);
        }

        let minRequiredFF = expectedFF * thresholdFactor;
        if (minRequiredFF < 0.5) minRequiredFF = 0.5;

        if (!this.isForcedStalled) {
            let isMisfiring = (fuelFlow > 0.1 && fuelFlow < minRequiredFF);

            if (isMisfiring) {
                SimVar.SetSimVarValue("K:MAGNETO1_SET", "number", 0);
                this.isForcedStalled = true;
                this.stalledMixtureThreshold = currentMix + 10;
            }
        }
        else {
            if (currentMix > this.stalledMixtureThreshold) {
                SimVar.SetSimVarValue("K:MAGNETO1_SET", "number", 3);
                this.isForcedStalled = false;
            }
        }
    }

    updateTrimAdvisory() {
        if (typeof SimVar === "undefined") {
            this.trimCue = "";
            return;
        }

        const apOn = this.autopilotMode === "AP";
        if (!apOn) {
            this.trimCue = "";
            return;
        }

        const needTrim = !!SimVar.GetSimVarValue("L:PMS50_APGA_NEED_TRIM_INDICATOR", "Bool");
        const trimUp = !!SimVar.GetSimVarValue("L:PMS50_APGA_NEED_TRIM_UP_INDICATOR", "Bool");
        const trimDown = !!SimVar.GetSimVarValue("L:PMS50_APGA_NEED_TRIM_DOWN_INDICATOR", "Bool");

        if (!needTrim) {
            this.trimCue = "";
        } else if (trimUp) {
            this.trimCue = "TRIM UP";
        } else if (trimDown) {
            this.trimCue = "TRIM DOWN";
        } else {
            this.trimCue = "";
        }
    }

    // Returns "ALT" or "VNAV" depending on which target is reached first (more restrictive)
    getNextRestrictiveArmedMode(selectedAltFt, constraintAltFt, currentAltFt) {
        if (!isFinite(selectedAltFt) || !isFinite(currentAltFt)) return "ALT";
        if (!isFinite(constraintAltFt) || constraintAltFt === -1) return "ALT"; // no constraint -> ALT is next

        const climbing = selectedAltFt > currentAltFt;

        // "More restrictive" means "you'll hit this one first"
        // Climb: smaller altitude wins (cap)
        // Descent: larger altitude wins (floor)
        if (climbing) {
            return (constraintAltFt <= selectedAltFt) ? "VNAV" : "ALT";
        } else {
            return (constraintAltFt >= selectedAltFt) ? "VNAV" : "ALT";
        }
    }

    adjustPfdDimming(delta) {
        const step = 0.05; // adjust to taste
        this.PFD_dimming = Math.max(-0.3, Math.min(0.5, this.PFD_dimming + delta * step));

        if (typeof SimVar !== "undefined") {
            SimVar.SetSimVarValue("L:PFD_Dim.1", "Number", this.PFD_dimming);
        }

        this.Update && this.Update();
    }

    syncBaroOnStartup() {

        if (this.pfdPowered < 1) return;
        if (this.baroSyncDone) return;
        let camera_state = SimVar.GetSimVarValue("CAMERA STATE", "number");
        if (camera_state != 2) return;

        let simBaro = Number(SimVar.GetSimVarValue("SEA LEVEL PRESSURE", "inHg"));
        this.baro = simBaro;
        SimVar.SetSimVarValue("K:KOHLSMAN_SET", "number", Math.round(simBaro * 33.8639 * 16));

        this.baroSyncDone = true;
    }

    updatePowerUpState() {
        const isPowered = !!this.pfdPowered;

        // Rising edge: power just came on
        if (isPowered && !this.wasPowered) {
            this.powerUpActive = true;
            this.powerUpStartMs = Date.now();

            // Start TAWS self-test timer
            this.tawsTestStartMs = Date.now();
            this.tawsTestPending = true;
            this.tawsTestPlayed = false;
            SimVar.SetSimVarValue("L:TAWS_SYSTEM_TEST_OK", "Number", 0);
        }

        // If power is off, cancel startup
        if (!isPowered) {
            this.powerUpActive = false;
            this.powerUpStartMs = 0;

            this.tawsTestStartMs = 0;
            this.tawsTestPending = false;
            this.tawsTestPlayed = false;
            SimVar.SetSimVarValue("L:TAWS_SYSTEM_TEST_OK", "Number", 0);
        }

        // End startup after 10 seconds
        if (this.powerUpActive) {
            const elapsed = Date.now() - this.powerUpStartMs;
            if (elapsed >= this.powerUpDelayMs) {
                this.powerUpActive = false;
            }
        }

        // Fire TAWS test OK once, 30s after power-up
        if (isPowered && this.tawsTestPending && !this.tawsTestPlayed) {
            const tawsElapsed = Date.now() - this.tawsTestStartMs;
            if (tawsElapsed >= this.tawsTestDelayMs) {
                this.tawsTestPlayed = true;
                this.tawsTestPending = false;
                SimVar.SetSimVarValue("L:TAWS_SYSTEM_TEST_OK", "Number", 1);

                // auto-reset shortly after so the sound remains one-shot
                setTimeout(() => {
                    SimVar.SetSimVarValue("L:TAWS_SYSTEM_TEST_OK", "Number", 0);
                }, 500);
            }
        }

        this.wasPowered = isPowered;
    }

    turnLightsOff() {
        // Force OFF early (this is the "slap it awake" step)
        SimVar.SetSimVarValue("K:BEACON_LIGHTS_OFF", "number", 1);
        SimVar.SetSimVarValue("K:NAV_LIGHTS_OFF", "number", 1);
        SimVar.SetSimVarValue("K:STROBES_OFF", "number", 1);
        SimVar.SetSimVarValue("K:TAXI_LIGHTS_OFF", "number", 1);
        SimVar.SetSimVarValue("K:LANDING_LIGHTS_OFF", "number", 1);
        SimVar.SetSimVarValue("K:CABIN_LIGHTS_OFF", "number", 1);
        SimVar.SetSimVarValue("K:PANEL_LIGHTS_OFF", "number", 1);

    }

    turnNightLightsOn(masterOn) {

        if (masterOn) {
            SimVar.SetSimVarValue("K:BEACON_LIGHTS_ON", "number", 1);
            SimVar.SetSimVarValue("K:NAV_LIGHTS_ON", "number", 1);
            SimVar.SetSimVarValue("K:STROBES_ON", "number", 1);
            SimVar.SetSimVarValue("K:TAXI_LIGHTS_ON", "number", 1);
            SimVar.SetSimVarValue("K:LANDING_LIGHTS_ON", "number", 1);

        }
        SimVar.SetSimVarValue("K:CABIN_LIGHTS_ON", "number", 1);
        SimVar.SetSimVarValue("K:PANEL_LIGHTS_ON", "number", 1);
    }

    cabinLightRedWhite() {

        //get cabin/panel settings and set spotlight brightness
        let cabin_brightness = SimVar.GetSimVarValue("LIGHT POTENTIOMETER:1", "number") * 100;
        let panel_brightness = SimVar.GetSimVarValue("LIGHT POTENTIOMETER:3", "number") * 100;
        SimVar.SetSimVarValue("L:Spotlight", "number", cabin_brightness);

        //set cabin light color
        const red_light = SimVar.GetSimVarValue("L:cabin_light_red", "bool");
        if (red_light === 1) {//red cabin light
            SimVar.SetSimVarValue("K:LIGHT_POTENTIOMETER_4_SET", "number", 0);
            SimVar.SetSimVarValue("K:LIGHT_POTENTIOMETER_5_SET", "number", cabin_brightness);
        } else {//white cabin light
            SimVar.SetSimVarValue("K:LIGHT_POTENTIOMETER_4_SET", "number", cabin_brightness);
            SimVar.SetSimVarValue("K:LIGHT_POTENTIOMETER_5_SET", "number", 0);
        }
    }

    initLights() {
        let camera_state = SimVar.GetSimVarValue("CAMERA STATE", "number");
        if (camera_state > 2) return;

        const master = SimVar.GetSimVarValue("ELECTRICAL MASTER BATTERY:1", "Bool");

        if (this.light_timer === 0 && !master) this.turnLightsOff();//turn lights off on 1st run if master switch is on/master off leave lights setting
        if (this.light_timer === 999) return;//done counting
        this.light_timer++;
        SimVar.SetSimVarValue("L:light_timer", "number", this.light_timer);
        const tod = Number(SimVar.GetSimVarValue("E:TIME OF DAY", "enum")) || 1; // 1=Day,2=Dusk/Dawn,3=Night

        //delayed start ***** GO BELOW ******
        if (this.light_timer < 100) return;

        if (tod === 1) {//day lights
            SimVar.SetSimVarValue("K:CABIN_LIGHTS_ON", "number", 1);
            SimVar.SetSimVarValue("K:PANEL_LIGHTS_ON", "number", 1);
            SimVar.SetSimVarValue("K:LIGHT_POTENTIOMETER_1_SET", "number", 0);// pot off
            SimVar.SetSimVarValue("K:LIGHT_POTENTIOMETER_3_SET", "number", 0);// pot off

        } else {//night/dusk/dawn
            this.turnNightLightsOn(master);
            const targetPct = 30; // Set to 30% brightness at night/dusk/dawn
            SimVar.SetSimVarValue("K:LIGHT_POTENTIOMETER_1_SET", "number", targetPct);
            SimVar.SetSimVarValue("K:LIGHT_POTENTIOMETER_3_SET", "number", targetPct);

        }

        this.light_timer = 999; // Prevent further adjustments
        SimVar.SetSimVarValue("L:light_timer", "number", this.light_timer);
    }

    updateSmoothedFlightDirector() {
        const rawPitch = Number(this.fdPitch) || 0;
        const rawBank = Number(this.fdBank) || 0;

        if (!this.fdSmoothingInitialized) {
            this.fdPitchSmooth = rawPitch;
            this.fdBankSmooth = rawBank;
            this.fdSmoothingInitialized = true;
            return;
        }

        const a = this.fdSmoothFactor;

        this.fdPitchSmooth += (rawPitch - this.fdPitchSmooth) * a;
        this.fdBankSmooth += (rawBank - this.fdBankSmooth) * a;
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

    // Apply partial updates to existing touch boxes by id
    _applyTouchBoxPatch(patchArray) {
        const byId = new Map(this.touchBoxes.map(b => [b.id, b]));
        for (const p of patchArray) {
            if (byId.has(p.id)) {
                Object.assign(byId.get(p.id), p);
            }
        }
        this.touchBoxes = Array.from(byId.values());
    }

    // Switch to a compact 4-up layout for Misc. buttons (adjust sizes/positions as you need)
    _enterMiscLayout() {
        if (this._inMiscLayout) return;
        const baseX = 60;
        const y = 205;
        const pad = 2;

        // Example: slightly narrower buttons to fit 4 nicely without overlap
        const w = 58;
        const h = 60;

        this._applyTouchBoxPatch([
            { id: "options_btn_1", x: baseX + 0 * (w + pad), y, w, h },
            { id: "options_btn_2", x: baseX + 1 * (w + pad), y, w, h },
            { id: "options_btn_3", x: baseX + 2 * (w + pad), y, w, h },
            { id: "options_btn_4", x: baseX + 3 * (w + pad), y, w, h },
        ]);

        this._inMiscLayout = true;
        this.Update && this.Update();
    }

    // Restore original touch boxes and clear transient touch state
    _resetTouchLayout() {
        this.touchBoxes = JSON.parse(JSON.stringify(this._defaultTouchBoxes));
        this._inMiscLayout = false;

        // Clear transient touch state
        this.touchedBox = null;
        this._touchedOptionBtnIdx = null;
        this._touchedBack = false;

        this.Update && this.Update();
    }

    crsEditable() {
        if (typeof SimVar === "undefined") return false;
        if (this.selectedNavSource === "GPS") {
            // Use the appropriate simvar in your setup. Commonly "GPS OBS ACTIVE" is available.
            // If your install uses a different name, swap it here.
            const gpsObsActive = !!SimVar.GetSimVarValue("GPS OBS ACTIVE", "Bool");
            return gpsObsActive;
        }
        // VOR1/VOR2 always editable
        return true;
    }

    getWindString() {
        if (typeof SimVar !== "undefined") {
            const windDir = SimVar.GetSimVarValue("AMBIENT WIND DIRECTION", "degrees");
            const windSpd = SimVar.GetSimVarValue("AMBIENT WIND VELOCITY", "knots");
            if (isFinite(windDir) && isFinite(windSpd)) {
                const dir = Math.round(windDir).toString().padStart(3, "0");
                const spd = Math.round(windSpd).toString().padStart(2, "0");
                return dir + "\n" + spd;
            }
        }
        return "--\n--";
    }


    // This function should be called within your instrument's Update() loop
    updateTakeoffWindow() {
        this.isOnGround = SimVar.GetSimVarValue("SIM ON GROUND", "Bool");
        const radioHeight = SimVar.GetSimVarValue("RADIO HEIGHT", "Feet");
        const timeReset = 2000;

        //on the ground
        if (this.isOnGround) {
            this.flightCounter = 0;//reset flight counter on ground
            SimVar.SetSimVarValue("L:TAKEOFF_WINDOW", "Number", 0);
            //airborne
        } else {
            this.flightCounter += 1;
            if (this.flightCounter > timeReset || radioHeight > 1000) {
                SimVar.SetSimVarValue("L:TAKEOFF_WINDOW", "Number", 0);
                this.flightCounter = timeReset; //prevent overflow
            } else {
                SimVar.SetSimVarValue("L:TAKEOFF_WINDOW", "Number", 1);
            }
            SimVar.SetSimVarValue("L:TAKEOFF_COUNTER", "Number", this.flightCounter);
        }

    }



    latModeName(num) {
        switch (num) {
            case 0: return "";        // None
            case 1: return "ROL";    // Roll
            case 2: return "HDG";    // Heading
            case 3: return "GPS";    // GPS NAV
            case 4: return "VOR";    // VOR NAV
            case 5: return "LOC";    // ILS NAV
            case 6: return "BC";     // Back Course
            case 7: return "GPS"; // Approach GPS
            case 8: return "VOR"; // Approach VOR
            case 9: return "LOC"; // Approach LOC
            case 10: return "ROL";   // Wing Leveler
            case 11: return "GA";   // Go Around
            //case 12: return "CLVL";  // Combined LVL
            default: return "";
        }
    }

    vertModeName(num) {
        switch (num) {
            case 0: return "";        // None
            case 1: return "PIT";
            case 2: return "VS";
            case 3: return "ALT";
            case 4: return "GS";
            case 5: return "GP";
            case 6: return "IAS";
            case 7: return "VNAV";
            case 8: return "GA";
            //case 9: return "CLVL";
            default: return "";
        }
    }


    get isInteractive() { return true; }
    get templateID() { return "PFD_screen_ID"; }

    // --- MSFS instrument lifecycle: setup canvas, images, events, polling ---
    connectedCallback() {
        if (typeof super.connectedCallback === "function") super.connectedCallback();

        this.canvas = document.getElementById('pfdCanvas');

        // Centralized image loading
        const simMode = (typeof SimVar !== "undefined");
        const imageMap = [
            { key: "bezelImg", src: this.bezelImgSrc, sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/Gi-275_attitude_bezel.png" },
            { key: "fdImg", src: this.fdImgSrc, sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/Gi-275_attitude_FD.png" },
            { key: "horizonImg", src: this.horizonImgSrc, sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/horizonbackground.png" },
            { key: "bank_angleImg", src: this.bank_angleImgSrc, sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/bank_angle.png" },
            { key: "tapeShadeImg", src: this.tapeShadeImgSrc, sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/Gi-275_attitude_tape_shade.png" },
            { key: "overlayImg", src: this.overlayImgSrc, sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/Gi-275_attitude_overlay.png" },
            { key: "altBugImg", src: this.altBugImgSrc, sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/Gi-275_bug.png" },
            { key: "altAlertImg", src: this.altAlertImgSrc, sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/Gi-275_attitude_alt_alert.png" },
            { key: "horizonNumbersImg", src: this.horizonNumbersImgSrc, sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/horizonnumbers.png" },
            { key: "optionsImg", src: "ADI_options.png", sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/ADI_options.png" },
            { key: "miscOptionsImg", src: "misc_options.png", sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/misc_options.png" },
            { key: "vdiImg", src: "VDI.png", sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/VDI.png" },
            { key: "cdiImg", src: "CDI.png", sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/CDI.png" },
            { key: "directToImg", src: "direct.png", sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/direct.png" },
            { key: "backlightImg", src: "backlight.png", sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/backlight.png" }
        ];
        for (const entry of imageMap) {
            this.images[entry.key] = new Image();
            this.images[entry.key].onload = () => { this.Update(); };
            this.images[entry.key].onerror = function () { console.log("Image load error:", this.src); };
            this.images[entry.key].src = simMode ? entry.sim : entry.src;
        }
        this.bezelImg = this.images.bezelImg;
        this.fdImg = this.images.fdImg;
        this.horizonNumbersImg = this.images.horizonNumbersImg;
        this.horizonImg = this.images.horizonImg;
        this.bank_angleImg = this.images.bank_angleImg;
        this.tapeShadeImg = this.images.tapeShadeImg;
        this.overlayImg = this.images.overlayImg;
        this.altBugImg = this.images.altBugImg;
        this.altAlertImg = this.images.altAlertImg;
        this.optionsImg = this.images.optionsImg;
        this.miscOptionsImg = this.images.miscOptionsImg;
        this.vdiImg = this.images.vdiImg;
        this.cdiImg = this.images.cdiImg;
        this.directToImg = this.images.directToImg;
        this.backlightImg = this.images.backlightImg;

        // Touch overlays
        this.touchHighlightImgs = [];
        const touchMap = [
            { src: this.touchHighlightImgSrcs[0], sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/Gi-275_attitude_overlay_spd.png" },
            { src: this.touchHighlightImgSrcs[1], sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/Gi-275_attitude_overlay_alt.png" },
            { src: this.touchHighlightImgSrcs[2], sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/Gi-275_attitude_overlay_baro.png" },
            { src: this.touchHighlightImgSrcs[3], sim: "coui://html_ui/Pages/VCockpit/Instruments/PFD_screen/Gi-275_attitude_overlay_hdg.png" }
        ];
        for (const entry of touchMap) {
            const img = new Image();
            img.onload = () => { this.Update(); };
            img.onerror = function () { console.log("Image load error:", this.src); };
            img.src = simMode ? entry.sim : entry.src;
            this.touchHighlightImgs.push(img);
        }

        // Canvas event setup
        if (this.canvas) {
            this.canvas.addEventListener('mousedown', e => this._processTouchStart(e), false);
            this.canvas.addEventListener('mouseup', e => this._processTouchEnd(e), false);
        }

        if (simMode) {
            setInterval(() => { this.pollPFDKnobDeltas(); }, 100);
            setInterval(() => { this.pollPFDKnobButtons(); }, 100);
            setInterval(() => { this.pollGAbutton(); }, 100);
        }

        this._alertIntervalId = setInterval(() => {
            this.altAlertFlash = !this.altAlertFlash;
            if (this.altAlertType > 0 && this.altAlertCount > 0) {
                this.altAlertCount -= 1;
                if (this.altAlertCount == 0) {
                    this.altAlertType = 0;
                }
            }
            if (this.altAlertType > 0) { this.altAlertLast = this.altAlertType; }
            this.Update();
        }, 1000);

        // Recommended interval for smoothness: 60ms (~16 FPS)
        setInterval(() => this.Update(), 60);

        // Fixed-window DH spin sampler
        if (!this._dhSpin.intervalId) {
            this._dhSpin.intervalId = setInterval(() => {
                this._dhSpin.stepsLastWindow = this._dhSpin.stepsThisWindow;
                this._dhSpin.stepsThisWindow = 0;

                SimVar.SetSimVarValue("L:dh_steps_window", "number", this._dhSpin.stepsLastWindow);
            }, this._dhSpin.windowMs);
        }

        this.Update();
    }

    // --- Knob/Touch Event Processing and Polling ---
    pollPFDKnobDeltas() {
        // Poll for small knob delta
        let smallDelta = (typeof SimVar !== "undefined") ? SimVar.GetSimVarValue("L:PFD_KnobSmallDelta", "number") || 0 : 0;
        if (smallDelta !== 0) {
            this.lastInteractionTime = Date.now(); // Reset Timer
            this.handleKnobDelta(smallDelta, "small");
            SimVar.SetSimVarValue("L:PFD_KnobSmallDelta", "number", 0);
        }
        // Poll for large knob delta (future use)
        let largeDelta = (typeof SimVar !== "undefined") ? SimVar.GetSimVarValue("L:PFD_KnobLargeDelta", "number") || 0 : 0;
        if (largeDelta !== 0) {
            this.lastInteractionTime = Date.now(); // Reset Timer
            this.handleKnobDelta(largeDelta, "large");
            SimVar.SetSimVarValue("L:PFD_KnobLargeDelta", "number", 0);
        }
    }

    pollPFDKnobButtons() {
        // Long press button, fires sync logic
        let btnLongVal = (typeof SimVar !== "undefined") ? SimVar.GetSimVarValue("L:PFD_KnobButtonLong", "number") || 0 : 0;
        if (btnLongVal === 1) {
            this.lastInteractionTime = Date.now(); // Reset Timer
            this.handleKnobLongPress();
            SimVar.SetSimVarValue("L:PFD_KnobButtonLong", "number", 0);
        }
        // Short press button (future, if implemented)
        let btnShortVal = (typeof SimVar !== "undefined") ? SimVar.GetSimVarValue("L:PFD_KnobButtonShort", "number") || 0 : 0;
        if (btnShortVal === 1) {
            this.lastInteractionTime = Date.now(); // Reset Timer
            this.handleKnobShortPress();
            SimVar.SetSimVarValue("L:PFD_KnobButtonShort", "number", 0);
        }
    }

    // Full touch start: records which box, starts knob-repeat timers, and sets which option button was touched
    _processTouchStart(e) {
        this.lastInteractionTime = Date.now(); //timer reset
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.touches && e.touches.length > 0) ? (e.touches[0].clientX - rect.left) : (e.clientX - rect.left);
        const y = (e.touches && e.touches.length > 0) ? (e.touches[0].clientY - rect.top) : (e.clientY - rect.top);

        this.touchedBox = null;
        this._touchedOptionBtnIdx = null; // 0..3 for options buttons
        this._touchedBack = false;

        for (let box of this.touchBoxes) {
            if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
                this.touchedBox = box;
                break;
            }
        }

        if (!this.touchedBox) {
            this.Update && this.Update();
            return;
        }

        // Top-level selection targets for small knob edits
        if (["spd", "alt", "baro", "hdg"].includes(this.touchedBox.id)) {
            const mapping = { spd: 1, alt: 2, baro: 3, hdg: 4 };
            this.touchSelected = mapping[this.touchedBox.id];
        }

        // Knob button long press detector
        if (this.touchedBox.id === "small_knob_button") {
            this.knobPressBox = this.touchedBox.id;
            this.knobLongPressFired = false;
            if (this.knobLongPressTimer) clearTimeout(this.knobLongPressTimer);
            this.knobLongPressTimer = setTimeout(() => {
                this.handleKnobLongPress();
                this.knobLongPressFired = true;
                this.Update && this.Update();
            }, 2000);
        }

        // Small knob CW/CCW with repeat if menu closed
        if (this.touchedBox.id === "small_knob_cw") {
            if (this.showOptions) {
                this.handleKnobDelta(+1, "small");
            } else {
                this.knobHoldTimer = setInterval(() => this.handleKnobDelta(+1, "small"), 120);
                this.handleKnobDelta(+1, "small");
            }
        } else if (this.touchedBox.id === "small_knob_ccw") {
            if (this.showOptions) {
                this.handleKnobDelta(-1, "small");
            } else {
                this.knobHoldTimer = setInterval(() => this.handleKnobDelta(-1, "small"), 120);
                this.handleKnobDelta(-1, "small");
            }
        }

        // Large knob only scrolls (selection or page)
        if (this.touchedBox.id === "large_knob_cw") {
            if (this.showOptions) {
                this.optionsChange(+1);
                this.Update && this.Update();
            } else {
                this.knobHoldTimer = setInterval(() => this.handleKnobDelta(+1, "large"), 120);
                this.handleKnobDelta(+1, "large");
            }
        } else if (this.touchedBox.id === "large_knob_ccw") {
            if (this.showOptions) {
                this.optionsChange(-1);
                this.Update && this.Update();
            } else {
                this.knobHoldTimer = setInterval(() => this.handleKnobDelta(-1, "large"), 120);
                this.handleKnobDelta(-1, "large");
            }
        }

        // Record which options button was touched
        if (this.showOptions) {
            if (this.touchedBox.id === "options_back") {
                this._touchedBack = true;
                this.optionsSel = 0; // visual highlight OK
            } else {
                const btnIds = ["options_btn_1", "options_btn_2", "options_btn_3", "options_btn_4"];
                const idx = btnIds.indexOf(this.touchedBox.id);
                if (idx !== -1) {
                    this._touchedOptionBtnIdx = idx; // remember slot
                }
            }
        }

        this.Update && this.Update();
    }

    _processTouchEnd(e) {

        this.debugCnt += 1;

        if (this.touchedBox) {
            // Back always activates
            if (this._touchedBack || this.touchedBox.id === "options_back") {
                this.optionsSel = 0;
                this.optionsClick();
                this.touchedBox = null;
                this._touchedBack = false;
                this._touchedOptionBtnIdx = null;
                this.Update && this.Update();
                return;
            }

            // Handle options button taps via visible window mapping
            if (this._touchedOptionBtnIdx !== null) {
                const btnIdx = this._touchedOptionBtnIdx; // 0..3
                const fullList = this.getCurrentOptionsList(); // includes "Back" at 0
                const options = fullList.slice(1);            // only children 0-based

                // Always use 3 visible slots
                const visibleCount = 3;
                if (btnIdx >= visibleCount) {
                    // Ignore taps beyond visible window
                    this.touchedBox = null;
                    this._touchedOptionBtnIdx = null;
                    this.Update && this.Update();
                    return;
                }

                // USE THE NEW WINDOW START LOGIC HERE:
                let startIndex = this.getOptionsWindowStart(options.length, visibleCount);

                // Global index of the tapped entry
                let targetIndex = startIndex + btnIdx;
                targetIndex = Math.max(0, Math.min(targetIndex, options.length - 1));

                // Commit selection (+1 for "Back" offset)
                this.optionsSel = targetIndex + 1;

                // In root, a tap enters the child menu
                if (this.showOptions && this.optionsLevel === 0) {
                    this.optionsClick();
                    this.touchedBox = null;
                    this._touchedOptionBtnIdx = null;
                    this.Update && this.Update();
                    return;
                }

                // In child, a tap triggers the selected action
                if (this.showOptions && this.optionsLevel > 0) {
                    this.optionsClick();
                    this.touchedBox = null;
                    this._touchedOptionBtnIdx = null;
                    this.Update && this.Update();
                    return;
                }
            }
        }

        // Knob button short vs long press lifecycle
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

        // Stop any repeat timers from knob holds
        if (this.knobHoldTimer) {
            clearInterval(this.knobHoldTimer);
            this.knobHoldTimer = null;
        }

        if (!this.showOptions) {
            // Menu closed -> ensure default layout is restored
            this._resetTouchLayout();
        }

        this.Update && this.Update();
    }

    pollGAbutton() {
        const max_timer = 10;
        SimVar.SetSimVarValue("L:GA_BUTTON_TIMER", "number", this.GA_timer);

        // Wait until GA button is pressed AND nav is suspended before starting
        if (!this.GA_button) return;
        if (this.GA_timer === 0 && !this.navSuspended) return; // not yet suspended — wait

        // Timer is running
        if (this.GA_timer < max_timer) {
            this.GA_timer += 1;

            SimVar.SetSimVarValue("L:WTAP_LNav_Is_Suspended", "Number", 0);

            if (this.GA_timer === 1) {
                SimVar.SetSimVarValue("K:GPS_OBS", "number", 0);
            }
        }

        // Once timer completes OR we're above 2000ft AGL — reset everything
        if (this.GA_timer >= max_timer || (this.RA > 2000 && this.GA_timer > 0)) {
            SimVar.SetSimVarValue("K:GPS_OBS", "number", 0);
            SimVar.SetSimVarValue("L:PMS50_APGA_GA_BUTTON_STATE", "number", 0);
            this.GA_button = false;
            this.GA_timer = 0;
        }
    }

    // Replace getNavColors() with this version (uses PFD's selectedNavSource, not navSourceCode)
    getNavColors() {
        const isGps = (this.selectedNavSource === "GPS");
        const magenta = "#ff00ff";
        const green = "#00ff00";
        return {
            cdiColor: isGps ? magenta : green,
            vdiColor: isGps ? magenta : green
        };
    }

    knotsToMph(knots, decimals = 0) {
        const KTS_TO_MPH = 1.15078;
        const mph = knots * KTS_TO_MPH;
        return typeof decimals === "number" ? Number(mph.toFixed(decimals)) : mph;
    }

    // Helper: fire OBS inc/dec events for the current nav source
    fireObsSteps(steps) {
        const detents = Math.abs(Math.round(steps) || 0);
        if (!detents || typeof SimVar === "undefined") return;

        let incEvt = "", decEvt = "";
        switch (this.selectedNavSource) {
            case "GPS":
                incEvt = "K:GPS_OBS_INC";
                decEvt = "K:GPS_OBS_DEC";
                break;
            case "NAV1":
                incEvt = "K:VOR1_OBI_INC";
                decEvt = "K:VOR1_OBI_DEC";
                break;
            case "NAV2":
                incEvt = "K:VOR2_OBI_INC";
                decEvt = "K:VOR2_OBI_DEC";
                break;
            default:
                return; // unknown source, do nothing
        }

        const up = steps > 0;
        for (let i = 0; i < detents; i++) {
            SimVar.SetSimVarValue(up ? incEvt : decEvt, "number", 1);
        }

        // Read back for UI
        this.course = this.getSelectedCourse();
        this.Update && this.Update();
    }

    handleKnobDelta(delta, size) {
        const steps = Math.round(delta);
        if (!steps) return;

        // ---------------------------
        // OPTIONS MENU BEHAVIOR (PFD)
        // ---------------------------
        if (this.showOptions) {
            // LARGE knob navigates the menu (selection)
            if (size === "large" || size === 2) {
                this.optionsChange(steps);
                this.Update && this.Update();
                return;
            }

            // SMALL knob edits items (only when applicable); otherwise do nothing
            if (size === "small" || size === 1) {
                this._dhSpin.stepsThisWindow += Math.abs(steps);

                const list = this.getCurrentOptionsList();
                const choice = list[this.optionsSel];

                // Backlight submenu: small knob changes brightness directly
                if (this.optionsParent === "Backlight") {
                    // Choose direction you prefer:
                    // If CW should BRIGHTEN, use -Math.sign(steps) or +Math.sign(steps)
                    // Your existing code uses Brighter => adjustPfdDimming(-1)
                    // so we match that: CW -> brighter -> -1
                    const s = Math.sign(steps || 1);
                    this.adjustPfdDimming(-s);
                    this.Update && this.Update();
                    return;
                }

                // Disabled option? do nothing (don’t navigate)
                if (this.isOptionDisabled(choice)) {
                    this.Update && this.Update();
                    return;
                }

                // Special case: HDG Options -> "HDG" editable with small knob
                if (this.optionsParent === "HDG Options" && choice === "HDG") {
                    this.adjustHeadingOrTrack(steps);
                    this.Update && this.Update();
                    return;
                }

                // Editable options (CRS, CDI, Vr, etc.)
                if (this.isEditableOption(choice)) {
                    const mult = (choice === "Altitude") ? this.getKnobStepMultiplier() : 1;
                    this.applyOptionDelta(choice, steps * mult);
                    this.Update && this.Update();
                    return;
                }

                // Not editable and not Backlight: do nothing on small knob
                this.Update && this.Update();
                return;
            }
        }

        // ---------------------------
        // NORMAL (MENU CLOSED) BEHAVIOR
        // ---------------------------
        if (size === "small" || size === 1) {
            if (this.touchSelected === 1) {
                // SPD bug
                if (typeof SimVar !== "undefined") {
                    const detents = Math.abs(steps);
                    const sign = Math.sign(steps) || +1;

                    let currentKts = Number(SimVar.GetSimVarValue("AUTOPILOT AIRSPEED HOLD VAR", "knots"));
                    if (!isFinite(currentKts)) {
                        currentKts = Number(SimVar.GetSimVarValue("L:PMS50_APGA_SELECTED_AIRSPEED", "knots")) || 0;
                    }

                    const newKts = Math.max(0, Math.round(currentKts + sign * detents));
                    SimVar.SetSimVarValue("AUTOPILOT AIRSPEED HOLD VAR", "knots", newKts);
                    SimVar.SetSimVarValue("L:PMS50_APGA_SELECTED_AIRSPEED", "knots", newKts);

                    for (let i = 0; i < detents; i++) {
                        SimVar.SetSimVarValue(sign > 0 ? "K:AP_SPD_VAR_INC" : "K:AP_SPD_VAR_DEC", "number", 1);
                    }

                    this.airspeedBug = Math.round(newKts * 1.15078);
                }
            } else if (this.touchSelected === 2) {
                // ALT bug (small inc/dec)
                if (typeof SimVar !== "undefined") {
                    const detents = Math.abs(steps);
                    const up = steps > 0;
                    for (let i = 0; i < detents; i++) {
                        SimVar.SetSimVarValue(up ? "H:PMS50_APGA_SEL_ALT_SMALL_INC" : "H:PMS50_APGA_SEL_ALT_SMALL_DEC", "number", 1);
                        SimVar.SetSimVarValue(up ? "K:PMS50_APGA_SEL_ALT_SMALL_INC" : "K:PMS50_APGA_SEL_ALT_SMALL_DEC", "number", 1);
                    }
                    const selAlt = Number(SimVar.GetSimVarValue("L:PMS50_APGA_SELECTED_ALTITUDE", "feet"));
                    if (isFinite(selAlt)) this.altitudeBug = selAlt;
                }
            } else if (this.touchSelected === 3) {
                // BARO
                this.adjustBaro(0.01 * steps);
            } else if (this.touchSelected === 4) {
                // HDG/TRK bug via helper
                this.adjustHeadingOrTrack(steps);
            }

            this.Update && this.Update();
            return;
        }

        // Large knob (menu closed): currently unused
        if (size === "large" || size === 2) {
            return;
        }
    }

    adjustHeadingOrTrack(steps) {
        const detents = Math.round(steps);
        if (!detents) return;

        if (this.trkHold) {
            // Track bug
            let trkSelNew = (Math.round(this.trkSel + detents)) % 360;
            if (trkSelNew < 0) trkSelNew += 360;
            this.trkSel = trkSelNew;
            if (typeof SimVar !== "undefined") {
                SimVar.SetSimVarValue("L:TRK_SEL", "number", this.trkSel);
            }
        } else {
            // Heading bug
            let newHdg = (Math.round(this.headingBug + detents)) % 360;
            if (newHdg < 0) newHdg += 360;
            this.headingBug = newHdg;
            if (typeof SimVar !== "undefined") {
                SimVar.SetSimVarValue("K:HEADING_BUG_SET", "degrees", Math.round(this.headingBug));
            }
        }

        this.Update && this.Update();
    }

    handleKnobLongPress() {
        // If options menu is open, long press closes it
        if (this.showOptions) {
            this.showOptions = false;
            this.optionsLevel = 0;
            this.optionsParent = "";
            this.optionsSel = 1;
            this.optionsEditing = false;
            this.optionsEditKey = "";
            this._resetTouchLayout();
            this.Update();
            return;
        }

        if (this.touchSelected === 2) {
            this.altitudeBug = Math.round(this.alt);
            SimVar.SetSimVarValue("L:PMS50_APGA_SELECTED_ALTITUDE", "feet", this.altitudeBug);
        }
        else if (this.touchSelected === 3) {
            this.baro = 29.92;
            SimVar.SetSimVarValue("KOHLSMAN SETTING HG", "inHg", this.baro);
        }
        else if (this.touchSelected === 4) {
            if (this.trkHold) {
                this.trkSel = this.heading;
                SimVar.SetSimVarValue("L:TRK_SEL", "number", this.trkSel);
            } else {
                this.headingBug = this.heading;
                SimVar.SetSimVarValue("K:HEADING_BUG_SET", "degrees", Math.round(this.headingBug));
            }
        }
        this.Update();
    }

    handleKnobShortPress() {
        this.optionsClick();
        this.Update();
    }

    handleBaroKnob(delta) {
        if (this.touchSelected === 3) {
            this.adjustBaro(0.01 * delta);
        }
    }

    getKnobStepMultiplier() {
        const n = (this._dhSpin && this._dhSpin.stepsLastWindow) ? this._dhSpin.stepsLastWindow : 0;

        // n = detents in the last windowMs (default 200ms)
        // Example: 1 detent/200ms = 5 detents/sec (slow)
        //          6 detents/200ms = 30 detents/sec (fast)

        if (n >= 15) return 1000; // very fast
        if (n >= 6) return 100;  // fast
        if (n >= 2) return 10;   // medium
        return 1;                // slow
    }

    adjustBaro(delta) {
        let steps = Math.round(delta / 0.01) || Math.sign(delta) || 0;
        if (!steps) return;

        if (this.baroMode === 1) {
            // Work in hPa so every knob click changes exactly 1 hPa
            let hpa = Math.round(this.baro * 33.8639);
            hpa += steps;

            if (hpa < 985) hpa = 985;
            if (hpa > 1040) hpa = 1040;

            this.baro = hpa / 33.8639;
        } else {
            // Work in inHg so every knob click changes exactly 0.01 inHg
            let newBaro = this.baro + (0.01 * steps);

            if (newBaro < 29.00) newBaro = 29.00;
            if (newBaro > 31.00) newBaro = 31.00;

            this.baro = parseFloat(newBaro.toFixed(2));
        }

        this.Update();
    }


    // Change 1: Make the NAV Options entry dynamic based on this.trkHold
    getCurrentOptionsList() {
        if (this.optionsLevel === 0) {
            return ["Back", ...this.optionsRoot];
        }
        const parent = this.optionsParent;
        const children = [...(this.optionsChildren[parent] || [])];

        // Dynamically rename "HDG Options" -> "TRK Options" when TRK hold is active
        if (parent === "NAV Options") {
            const i = children.indexOf("HDG Options");
            if (i !== -1) {
                children[i] = this.trkHold ? "TRK Options" : "HDG Options";
            }
        }

        return ["Back", ...children];
    }

    optionsChange(delta) {
        const list = this.getCurrentOptionsList();
        const max = list.length - 1;
        if (delta > 0) this.optionsSel += 1;
        else if (delta < 0) this.optionsSel -= 1;

        if (this.optionsSel > max) this.optionsSel = 0;
        if (this.optionsSel < 0) this.optionsSel = max;

        if (this.optionsLevel > 0 && this.optionsParent === "Misc. Field" && this.optionsSel > 0) {
            const miscChildren = this.optionsChildren["Misc. Field"];
            const selectedChild = miscChildren[this.optionsSel - 1];
            const miscMapping = { "TAS": 0, "GS": 1, "OAT": 2, "Wind": 3 };
        }
    }



    // Add this helper to convert numeric nav source code to short text
    getNavSourceText() {
        switch (Number(this.navSourceCode) || 0) {
            case 0: return "GPS";
            case 1: return "NAV1";
            case 2: return "NAV2";
            default: return "";
        }
    }

    getVTGtype(txt) {
        switch (txt) {
            case "GS": return 0;
            case "GP": return 1;
            case "VNAV": return 2;
            default: return -1;
        }
    }

    // Keep course cached in sync whenever NAV source changes
    cyclePfdNavSource(dir = +1) {
        const order = ["GPS", "NAV1", "NAV2"];
        let idx = Math.max(0, order.indexOf(this.selectedNavSource));
        idx = (idx + (dir >= 0 ? 1 : -1) + order.length) % order.length;
        this.selectedNavSource = order[idx];

        if (typeof SimVar !== "undefined") {
            const map = { GPS: 0, VOR1: 1, VOR2: 2 };
            SimVar.SetSimVarValue("L:PFD_NavSrc.1", "Number", map[this.selectedNavSource]);
        }

        // Update TO/FROM and CDI (unchanged from your code)
        if (this.selectedNavSource === "GPS") {
            this.toFromFlag = 1;
            this.cdiDeflection = Number(SimVar.GetSimVarValue("GPS CDI NEEDLE", "Number")) || 0;
        } else if (this.selectedNavSource === "NAV1") {
            this.toFromFlag = Number(SimVar.GetSimVarValue("NAV TOFROM:1", "Number")) || 0;
            this.cdiDeflection = Number(SimVar.GetSimVarValue("NAV CDI:1", "Number")) || 0;
        } else if (this.selectedNavSource === "NAV2") {
            this.toFromFlag = Number(SimVar.GetSimVarValue("NAV TOFROM:2", "Number")) || 0;
            this.cdiDeflection = Number(SimVar.GetSimVarValue("NAV CDI:2", "Number")) || 0;
        }

        // Sync course cache from SimVars immediately
        this.course = this.getSelectedCourse();

        this.Update && this.Update();
    }

    // Returns the currently selected course for the active nav source, safely normalized 0–359
    getSelectedCourse() {
        // Fallback to cached value if SimVar isn't available yet
        if (typeof SimVar === "undefined") {
            return (Number(this.course || 0) + 360) % 360;
        }

        let val = 0;
        switch (this.selectedNavSource) {
            case "GPS":
                // GPS course is the OBS value (only editable when OBS is active)
                val = Number(SimVar.GetSimVarValue("GPS OBS VALUE", "degrees")) || 0;
                break;
            case "NAV1":
                val = Number(SimVar.GetSimVarValue("NAV OBS:1", "degrees")) || 0;
                break;
            case "NAV2":
                val = Number(SimVar.GetSimVarValue("NAV OBS:2", "degrees")) || 0;
                break;
            default:
                val = Number(this.course || 0); // cached fallback
        }
        return (val + 360) % 360;
    }


    // 5) Update applyOptionDelta(): make "Altitude" adjust DH (only if enabled)

    applyOptionDelta(label, delta) {
        const step = Math.round(delta) || 0;

        if (label === "CDI") {
            this.cyclePfdNavSource(Math.sign(delta || +1));
            return;
        }

        if (label === "CRS") {
            if (!this.crsEditable()) return;
            this.fireObsSteps(step);
            return;
        }

        if (label === "HDG") {
            this.adjustHeadingOrTrack(step);
            return;
        }

        if (label === "Vr") {
            this.Vr = Math.max(0, Math.round(this.Vr + step));
            if (typeof SimVar !== "undefined") SimVar.SetSimVarValue("L:Vr.1", "number", this.Vr);
            return;
        } else if (label === "Vx") {
            this.Vx = Math.max(0, Math.round(this.Vx + step));
            if (typeof SimVar !== "undefined") SimVar.SetSimVarValue("L:Vx.1", "number", this.Vx);
            return;
        } else if (label === "Vy") {
            this.Vy = Math.max(0, Math.round(this.Vy + step));
            if (typeof SimVar !== "undefined") SimVar.SetSimVarValue("L:Vy.1", "number", this.Vy);
            return;
        } else if (label === "GLIDE") {
            this.Vg = Math.max(0, Math.round(this.Vg + step));
            if (typeof SimVar !== "undefined") SimVar.SetSimVarValue("L:Vg.1", "number", this.Vg);
            return;
        }

        // Minimums Bug toggle is handled in optionsClick(), not here.

        // NEW: Minimums -> Altitude edits DH, but only when Minimums Bug is ON
        if (label === "Altitude") {
            if (!this.minimumsBugOn) return; // disabled
            this.minimumsDh = Math.max(0, Math.round((this.minimumsDh || 0) + step));
            if (typeof SimVar !== "undefined") {
                SimVar.SetSimVarValue("L:PFD_MINIMUMS_DH", "number", this.minimumsDh);
            }
            return;
        }
    }

    getOptionsWindowStart(optionsLength, visibleCount = 3) {
        // Initialize if it doesn't exist
        if (typeof this.optionsWindowStart !== "number") {
            this.optionsWindowStart = 0;
        }

        // Get the current 0-based selected index
        const selectedIndex = Math.max(0, (this.optionsSel || 1) - 1);

        // If the selection moved off the right edge, scroll right
        if (selectedIndex >= this.optionsWindowStart + visibleCount) {
            this.optionsWindowStart = selectedIndex - visibleCount + 1;
        }
        // If the selection moved off the left edge, scroll left
        else if (selectedIndex < this.optionsWindowStart) {
            this.optionsWindowStart = selectedIndex;
        }

        // Clamp the scroll so it doesn't go out of bounds
        const maxStart = Math.max(0, optionsLength - visibleCount);
        this.optionsWindowStart = Math.max(0, Math.min(this.optionsWindowStart, maxStart));

        return this.optionsWindowStart;
    }

    optionsClick() {
        // 1) Open root menu if currently closed
        if (!this.showOptions) {
            this.showOptions = true;
            this.optionsLevel = 0;
            this.optionsParent = "";
            this.optionsSel = 1;
            this.optionsWindowStart = 0; // RESET SCROLL
            this.optionsEditing = false;
            this.optionsEditKey = "";
            this._touchedOptionBtnIdx = null;
            this._touchedBack = false;
            this._optionsVisibleButtons = 3;
            this.menuHistory = [];            // Reset history stack
            this._resetTouchLayout();
            return;
        }

        const list = this.getCurrentOptionsList();
        const choice = list[this.optionsSel];

        // 2) Back handling using History Stack
        if (this.optionsSel === 0) {
            if (this.menuHistory && this.menuHistory.length > 0) {
                this.optionsParent = this.menuHistory.pop();
                this.optionsLevel = this.menuHistory.length;
                this.optionsSel = 1;
                this.optionsWindowStart = 0; // RESET SCROLL
                this.optionsEditing = false;
                this.optionsEditKey = "";
                this._optionsVisibleButtons = 3;
                this._resetTouchLayout();
            } else {
                this.showOptions = false;
                this.optionsLevel = 0;
                this.optionsParent = "";
                this._resetTouchLayout();
            }
            this._touchedOptionBtnIdx = null;
            this._touchedBack = false;
            return;
        }

        // 3) Sub-menu Traversal (Dynamic!)
        if (this.optionsChildren[choice]) {
            if (!this.menuHistory) this.menuHistory = [];
            this.menuHistory.push(this.optionsParent); // Save current level

            this.optionsParent = choice;
            this.optionsLevel = this.menuHistory.length;
            this.optionsSel = 1;
            this.optionsWindowStart = 0; // RESET SCROLL
            this.optionsEditing = false;
            this.optionsEditKey = "";
            this._touchedOptionBtnIdx = null;
            this._touchedBack = false;
            this._optionsVisibleButtons = 3;
            this._resetTouchLayout();
            return;
        }

        if (typeof SimVar !== "undefined") {
            SimVar.SetSimVarValue("L:PFD_LAST_OPTION_SELECTED", "string", `${this.optionsParent}:${choice}`);
        }

        if (this.optionsParent === "Units") {
            if (choice === "BARO") {
                this.baroMode = this.baroMode === 1 ? 0 : 1;
                return;
            }
        }

        // 4) Per-child-menu actions
        if (this.optionsParent === "CRS Options") {
            if (choice === "CRS") {
                if (this.crsEditable()) {
                    const togglingSame = this.optionsEditing && this.optionsEditKey === "CRS";
                    this.optionsEditing = !togglingSame;
                    this.optionsEditKey = togglingSame ? "" : "CRS";
                } else {
                    this.optionsEditing = false;
                    this.optionsEditKey = "";
                }
            }
            return;
        }

        if (this.optionsParent === "HDG Options") {
            if (choice === "HDG") {
                const togglingSame = this.optionsEditing && this.optionsEditKey === "HDG";
                this.optionsEditing = !togglingSame;
                this.optionsEditKey = togglingSame ? "" : "HDG";
            }
            return;
        }

        if (this.optionsParent === "Misc. Field") {
            const miscMapping = { "TAS": 0, "GS": 1, "OAT": 2, "Wind": 3 };
            if (choice === "Off") {
                this.miscOption = -1;
            } else if (choice in miscMapping) {
                // Toggle OFF if already selected, otherwise turn ON
                if (this.miscOption === miscMapping[choice]) {
                    this.miscOption = -1;
                } else {
                    this.miscOption = miscMapping[choice];
                }
            }
            if (typeof SimVar !== "undefined") {
                SimVar.SetSimVarValue("L:PFD_Misc.1", "number", this.miscOption);
            }
            return;
        }

        if (this.optionsParent === "Wind Settings") {
            const windMapping = { "<-MPH ^MPH": 0, "DEG MPH": 1, "<- MPH": 2 };
            if (choice in windMapping) {
                // Set the selected wind style
                this.windOption = windMapping[choice];
                if (typeof SimVar !== "undefined") {
                    SimVar.SetSimVarValue("L:PFD_Wind_Style.1", "number", this.windOption);
                }
            }
            return;
        }

        // --- Airspeeds / Minimums edit toggles ---
        if (this.optionsParent === "Airspeeds" || this.optionsParent === "Minimums") {
            if (this.optionsParent === "Airspeeds") {
                if (choice === "All On") {
                    this.vSpeedShow = { Vr: true, Vx: true, Vy: true, Vg: true };
                    return;
                }
                if (choice === "All Off") {
                    this.vSpeedShow = { Vr: false, Vx: false, Vy: false, Vg: false };
                    return;
                }
                if (["Vr", "Vx", "Vy", "GLIDE"].includes(choice)) {
                    const key = choice === "GLIDE" ? "Vg" : choice;
                    this.vSpeedShow[key] = !this.vSpeedShow[key];
                    return;
                }
            }

            if (this.optionsParent === "Minimums" && choice === "Minimums Bug") {
                this.minimumsBugOn = !this.minimumsBugOn;
                if (!this.minimumsBugOn) {
                    this.optionsEditing = false;
                    this.optionsEditKey = "";
                    this.optionsSel = 1;
                }
                return;
            }

            if (this.optionsParent === "Minimums" && choice === "Altitude") {
                if (!this.minimumsBugOn) {
                    this.optionsEditing = false;
                    this.optionsEditKey = "";
                    return;
                }
                const togglingSame = this.optionsEditing && this.optionsEditKey === "Altitude";
                this.optionsEditing = !togglingSame;
                this.optionsEditKey = togglingSame ? "" : "Altitude";
                return;
            }
            return;
        }

        if (this.optionsParent === "NAV Options") {
            if (choice === "CDI") {
                const order = ["GPS", "NAV1", "NAV2"];
                let idx = Math.max(0, order.indexOf(this.selectedNavSource || "GPS"));
                idx = (idx + 1) % order.length;
                this.selectedNavSource = order[idx];

                if (typeof SimVar !== "undefined") {
                    const code = (this.selectedNavSource === "GPS") ? 0 : (this.selectedNavSource === "NAV1") ? 1 : 2;
                    SimVar.SetSimVarValue("L:PFD_NavSrc.1", "Number", code);
                }
                this.identColor = (this.selectedNavSource === "GPS") ? "#e049b0" : "#00ff00";
                return;
            }

            if (choice === "CDI/VDI Preview") {
                this.cdiVdiPreviewOn = !this.cdiVdiPreviewOn;
                if (typeof SimVar !== "undefined") {
                    SimVar.SetSimVarValue("L:PFD_NavPrev.1", "Number", this.cdiVdiPreviewOn ? 1 : 0);
                }
                return;
            }

            if (choice === "CRS Devs") {
                // Toggle between 1 and 0
                this.courseDevs = (this.courseDevs === 1) ? 0 : 1;
                if (typeof SimVar !== "undefined") {
                    SimVar.SetSimVarValue("L:PFD_CrsDevs.1", "Number", this.courseDevs);
                }
                return;
            }
            return;
        }

        if (this.optionsParent === "Backlight") {
            if (choice === "Brighter") {
                this.adjustPfdDimming(-1);
                return;
            }
            if (choice === "Dimmer") {
                this.adjustPfdDimming(+1);
                return;
            }
        }
        return;
    }

    isEditableOption(label) {
        return ["CDI", "CRS", "HDG", "Vr", "Vx", "Vy", "GLIDE", "Minimums Bug", "Altitude"].includes(label);
    }

    isOptionDisabled(label) {
        // Only disable "Altitude" row when minimums bug is OFF
        if (this.optionsParent === "Minimums" && label === "Altitude") {
            return !this.minimumsBugOn;
        }
        return false;
    }

    getOptionAlpha(label) {
        return this.isOptionDisabled(label) ? 0.5 : 1.0;
    }

    // 4) Update getOptionLabelLines() to show DH value on the "Altitude" row

    getOptionLabelLines(label) {
        if (label === "CRS") {
            const crs = Math.round(this.course);
            const text = String(crs).padStart(3, "0");
            return ["CRS", text];
        }
        if (label === "HDG") {
            const hdg = Math.round(this.headingBug) % 360;
            const text = String(hdg === 0 ? 360 : hdg).padStart(3, "0");
            return ["HDG", text];
        }
        if (label === "CDI") return ["CDI", this.selectedNavSource || ""];
        if (label === "Vr") return ["Vr", String(Math.round(this.Vr))];
        if (label === "Vx") return ["Vx", String(Math.round(this.Vx))];
        if (label === "Vy") return ["Vy", String(Math.round(this.Vy))];
        if (label === "GLIDE") return ["GLIDE", String(Math.round(this.Vg))];
        if (label === "BARO") {
            return ["BARO", this.baroMode === 1 ? "hPa" : "in Hg"];
        }

        if (label === "Minimums Bug") {
            return ["Minimums", "Bug"];
        }

        // NEW: Minimums -> Altitude shows DH value
        if (label === "Altitude") {
            const dh = Math.max(0, Math.round(this.minimumsDh || 0));
            return ["Altitude", `${dh}FT`];
        }

        const parts = (label || "").split(" ");
        if (parts.length > 1) return [parts[0], parts.slice(1).join(" ")];
        return [label];
    }

    // Replace the existing drawOptionLabel method inside the PFD_screen class
    drawOptionLabel(ctx, lines, x, y, firstLineColor, secondLineColor) {
        const parts = Array.isArray(lines) ? lines : String(lines || "").split(" ");
        const fullLabel = parts.join(" ");
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

        // --- INTERCEPT "D->" AND DRAW DIRECT-TO IMAGE ---
        if (fullLabel === "D->" && this.directToImg && this.directToImg.complete && this.directToImg.naturalWidth > 0) {
            ctx.save();
            // Adjust w and h to fit nicely inside your 65x60 touchboxes
            const w = 45;
            const h = 45;
            ctx.drawImage(this.directToImg, x - w / 2, y - h / 2, w, h);
            ctx.restore();
            return;
        }

        // --- INTERCEPT "Backlight" AND DRAW BACKLIGHT IMAGE ---
        if (fullLabel === "Backlight" && this.backlightImg && this.backlightImg.complete && this.backlightImg.naturalWidth > 0) {
            ctx.save();
            // Adjust w and h to fit nicely inside your 65x60 touchboxes
            const w = 45;
            const h = 45;
            ctx.drawImage(this.backlightImg, x - w / 2, y - h / 2, w, h);
            ctx.restore();
            return;
        }

        // Single-line labels (Default text rendering)
        if (parts.length <= 1) {
            ctx.save();
            ctx.fillStyle = firstLineColor || "#ffffff";
            ctx.fillText(parts[0] || "", x, y);
            ctx.restore();
            return;
        }

        // First line
        ctx.save();
        ctx.fillStyle = firstLineColor || "#ffffff";
        ctx.fillText(parts[0], x, y - (lineGap / 2) - 5);
        ctx.restore();

        // Second line
        ctx.save();
        const color = (secondLineColor !== undefined && secondLineColor !== null)
            ? secondLineColor
            : "#ffffff";
        ctx.fillStyle = color;
        ctx.fillText(parts.slice(1).join(" "), x, y + (lineGap / 2));
        ctx.restore();
    }


    // Drawing methods (copied from your original, unchanged except altitude bug logic):

    drawAltitudeTape(ctx) {
        const w = this.canvas.width, h = this.canvas.height;
        const cx = w / 2, cy = h / 2;
        const R = Math.min(w, h) * 0.43;

        const altBox = this.touchBoxes[1];
        const baroBox = this.touchBoxes[2];

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

    drawCurrentAltitudeBox(ctx, cx, cy, R) {
        let alt = Number(this.alt) || 0;
        if (alt <= -900) alt = -900;
        const isNegative = alt < 0;
        const absAlt = Math.abs(alt);

        // Visual states (no alerts on altitude box itself)
        const isBelowThreshold = alt >= 0 && alt < 20;

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

        // Draw minus sign for negative altitudes
        if (isNegative) {
            ctx.save();
            ctx.fillStyle = "#FFFFFF";
            ctx.font = DIGIT_FONT;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("-", boxX + leftTrim + 6, cy + 1);
            ctx.restore();
        }

        // 2) Altitude decomposition using absolute value
        const thousandsDigit = Math.floor(absAlt / 10000);          // ten-thousands place
        const hundredsDigit = Math.floor((absAlt % 10000) / 1000); // thousands place
        const tensDigit = Math.floor((absAlt % 1000) / 100);       // hundreds place

        // Vertical drum: two-digit 00/20/40/60/80 values
        const withinHundred = absAlt % 100;
        const stepSize = 20;
        const stepIndex = Math.floor(withinHundred / stepSize);
        const stepFraction = (withinHundred % stepSize) / stepSize;
        const drumValues = [0, 20, 40, 60, 80];
        const currentDrumVal = drumValues[stepIndex];
        const nextDrumVal = drumValues[(stepIndex + 1) % 5];

        // 3) Cascade trigger logic
        let tensRemainder = (stepIndex === 4) ? stepFraction : 0;

        const withinThousand = absAlt % 1000;
        let hundredsRemainder = (withinThousand >= 980)
            ? (withinThousand - 980) / 20
            : 0;

        const withinTenThousand = absAlt % 10000;
        let thousandsRemainder = (withinTenThousand >= 9980)
            ? (withinTenThousand - 9980) / 20
            : 0;

        // 4) Colors and baseline
        let colorRGB = "255, 255, 255";
        ctx.font = DIGIT_FONT;
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";

        // --- SQUISH: bring columns closer while keeping rightmost fixed ---
        const squish = 6;
        const step = digitW - squish;

        // Shift numeric columns slightly right if minus sign is present
        const minusOffset = isNegative ? 8 : 0;

        // Keep tens column fixed (rightmost)
        const tenX = boxX + 3 + digitW * 2;
        const hunX = tenX - step + minusOffset;
        const thouX = hunX - step + minusOffset;

        // --- THOUSANDS DRUM (ten-thousands place, leftmost) ---
        if (thousandsDigit > 0 || thousandsRemainder > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(thouX, boxTopY + 2, digitW, horizBoxH - 4);
            ctx.clip();

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
            ctx.beginPath();
            ctx.rect(hunX, boxTopY + 2, digitW, horizBoxH - 4);
            ctx.clip();

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
        ctx.beginPath();
        ctx.rect(tenX, boxTopY + 2, digitW, horizBoxH - 4);
        ctx.clip();

        const tensCurrent = tensDigit;
        const tensNext = (tensDigit + 1) % 10;

        ctx.fillStyle = `rgba(${colorRGB}, ${1 - tensRemainder})`;
        ctx.fillText(tensCurrent, tenX + digitW / 2, cy + 1 - (tensRemainder * sep));

        if (tensRemainder > 0) {
            ctx.fillStyle = `rgba(${colorRGB}, ${tensRemainder})`;
            ctx.fillText(tensNext, tenX + digitW / 2, cy + 1 + sep - (tensRemainder * sep));
        }
        ctx.restore();

        // --- ONES DRUM (Vertical box) ---
        ctx.save();
        ctx.beginPath();
        ctx.rect(vertBoxX + 2, vertBoxY + 2, vertBoxW - 4, vertBoxH - 4);
        ctx.clip();
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


    drawHorizon(ctx) {
        if (!this.horizonImg || this.horizonImg.naturalWidth === 0) return;

        const width = this.canvas.width;
        const height = this.canvas.height;
        let pitch = this.pitch || 0;
        let roll = this.bank || 0;
        const pitchPixelsPerDeg = 6;// 2.3;

        // --- PART 1: Draw the full background image (Moves Freely) ---
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.rotate(roll * Math.PI / 180);
        ctx.translate(0, -pitch * pitchPixelsPerDeg);

        // Draw the main artificial horizon background
        ctx.drawImage(
            this.horizonImg,
            -this.horizonImg.naturalWidth / 2,
            -this.horizonImg.naturalHeight / 2,
            this.horizonImg.naturalWidth,
            this.horizonImg.naturalHeight
        );
        ctx.restore(); // Restore context to center point (clears all transforms)

        // --- PART 2: Draw the numbers (Clipped to Viewport) ---
        if (this.horizonNumbersImg && this.horizonNumbersImg.naturalWidth > 0) {
            ctx.save();

            const scaleY = 0.5;

            // 1. Clipping (unchanged)
            ctx.beginPath();
            const clipHeight = 150;
            ctx.rect(0, (height / 2) - (clipHeight / 2), width, clipHeight);
            ctx.clip();

            // 2. Move to the center of the canvas first
            ctx.translate(width / 2, height / 2);
            ctx.rotate(roll * Math.PI / 180);

            // 3. APPLY SCALE FIRST
            // This scales the coordinate system so 1 unit = 0.3 pixels
            ctx.scale(0.3, scaleY);

            // 4. APPLY TRANSLATION AFTER SCALE
            // Because we scaled first, we must adjust the pixelsPerDeg 
            // for this specific coordinate system (5 / 0.3 = 16.66)
            ctx.translate(0, -pitch * (pitchPixelsPerDeg / scaleY));

            // 5. Draw the image at its center
            const imgW = this.horizonNumbersImg.naturalWidth;
            const imgH = this.horizonNumbersImg.naturalHeight;

            ctx.drawImage(
                this.horizonNumbersImg,
                -imgW / 2,
                -imgH / 2,
                imgW,
                imgH
            );

            ctx.restore();
        }


    }



    drawBezel(ctx) {
        if (!this.bezelImg.complete || this.bezelImg.naturalWidth === 0) return;
        ctx.drawImage(this.bezelImg, 0, 0, this.canvas.width, this.canvas.height);
    }

    drawTapeShade(ctx) {
        if (!this.tapeShadeImg.complete || this.tapeShadeImg.naturalWidth === 0) return;
        ctx.drawImage(this.tapeShadeImg, 0, 0, this.canvas.width, this.canvas.height);
    }

    drawTouchHighlight(ctx) {
        if (this.touchSelected > 0 && this.touchSelected <= this.touchHighlightImgs.length) {
            let img = this.touchHighlightImgs[this.touchSelected - 1];
            if (img.complete && img.naturalWidth !== 0) {
                ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
            }
        }
    }

    drawOverlay(ctx) {
        if (!this.overlayImg || this.overlayImg.naturalWidth === 0) return;
        ctx.drawImage(this.overlayImg, 0, 0, this.canvas.width, this.canvas.height);
    }

    drawBaro(ctx) {
        const { x: boxX, y: boxY, w: boxW, h: boxH } = this.touchBoxes[2];
        ctx.save();
        ctx.font = "12px MSFS_LABEL";
        ctx.fillStyle = "#00eaff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        let baroStr = "----";

        if (this.baroMode === 1) {
            const hpa = this.baro * 33.8639;
            baroStr = `${Math.round(hpa)} hPa`;
        } else {
            baroStr = `${this.baro.toFixed(2)} in`;
        }

        ctx.fillText(baroStr, (boxX + boxW / 2) - 10, boxY + boxH / 2 + 1);
        ctx.restore();
    }

    drawBank(ctx) {
        if (!this.bank_angleImg.complete || this.bank_angleImg.naturalWidth === 0) return;
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
            this.bank_angleImg,
            -this.bank_angleImg.naturalWidth / 2,
            -this.bank_angleImg.naturalHeight / 2,
            this.bank_angleImg.naturalWidth,
            this.bank_angleImg.naturalHeight
        );
        ctx.restore();
    }

    updateAltitudeAlertType() {
        const diff = Math.abs(this.alt - this.altitudeBug);

        // REMOVED: Unconditional reset to 0 that was silencing the alert too fast.

        if (diff > 1000) {
            this.altAlertType = 0;
            this.altAlertReset = true;
            this.altAlertLast = 0;
            // Safely reset the L:Var here when outside the alert zone
            if (typeof SimVar !== "undefined") {
                SimVar.SetSimVarValue("L:ALTITUDE_ALERT", "number", 0);
            }
        }
        // If ≤1000ft and just reset, approach alert
        else if (diff <= 1000 && diff > 200 && this.altAlertReset && this.altAlertLast != 1) {
            this.altAlertType = 1;
            this.altAlertReset = false;
            this.altAlertCount = 5;
            // --- TRIGGER ALTITUDE ALERT SOUND ---
            if (typeof SimVar !== "undefined") {
                SimVar.SetSimVarValue("L:ALTITUDE_ALERT", "number", 1);
            }
        }
        // If ≤200ft difference and NOT just reset, acquisition alert
        else if (diff <= 200 && this.altAlertLast == 1) {
            this.altAlertType = 2;
            this.altAlertCount = 5;

            // Optionally clear the alert L:var here so it doesn't stay 1 indefinitely 
            // once you reach the target altitude.
            if (typeof SimVar !== "undefined") {
                SimVar.SetSimVarValue("L:ALTITUDE_ALERT", "number", 0);
            }
        }
        // If >200ft difference and NOT just reset, deviation alert
        else if (diff > 200 && this.altAlertType != 1 && this.altAlertLast != 1 && this.altAlertType != 3 && this.altAlertLast != 3) {
            this.altAlertType = 3;
            this.altAlertCount = 5;
        }
        //reset alert 3 if within
        else if (diff <= 200 && this.altAlertLast == 3) {
            this.altAlertLast = 0;
            this.altAlertType = 0;
        }
    }

    drawAltitudeSelectBox(ctx) {
        this.updateAltitudeAlertType();
        const { x: boxX, y: boxY, w: boxW, h: boxH } = this.touchBoxes[1];
        ctx.save();

        if (this.altAlertType === 1 && this.altAlertFlash) {
            ctx.drawImage(this.altAlertImg, 0, 0, this.canvas.width, this.canvas.height);
        }

        ctx.font = "12px MSFS_LABEL";
        let altSelect = (this.altitudeBug !== undefined && this.altitudeBug !== null)
            ? Math.round(this.altitudeBug).toLocaleString()
            : "----";

        if (this.altAlertType === 1 && this.altAlertFlash) {
            ctx.fillStyle = "#000";
        } else if (this.altAlertType === 2 && this.altAlertFlash) {
            ctx.fillStyle = "#000";
        } else if (this.altAlertType === 3 && this.altAlertFlash) {
            ctx.fillStyle = "#ffff0f";
        } else {
            ctx.fillStyle = "#00eaff";
        }

        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(altSelect, boxX + boxW / 2, boxY + boxH / 2 - 2);

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

        if (!this.altBugImg.complete || this.altBugImg.naturalWidth === 0) return;

        ctx.save();
        ctx.translate(bug_x, bug_y);
        ctx.rotate(bug_angle_rad);
        ctx.scale(-1, 1);
        ctx.drawImage(
            this.altBugImg,
            -this.altBugImg.naturalWidth / 2,
            -this.altBugImg.naturalHeight / 2,
            this.altBugImg.naturalWidth,
            this.altBugImg.naturalHeight
        );
        ctx.restore();
    }

    drawHeadingLabels(ctx, canvasWidth, canvasHeight, currentHeading) {
        const tapeLeft = 45, tapeRight = canvasWidth - 45;
        const tapeWidth = tapeRight - tapeLeft;
        const tapeTop = 60;
        const tapeHeight = 50;

        const totalSpan = 130;
        const majorStep = 10;
        let headingCenter = Math.round(currentHeading) % 360;

        for (let d = -totalSpan / 2; d <= totalSpan / 2; d += majorStep) {
            const tickHeading = (headingCenter + d + 360) % 360;
            const x = tapeLeft + tapeWidth / 2 + (d / totalSpan) * tapeWidth;
            let label;
            if (tickHeading === 0 || tickHeading === 360) label = "N";
            else if (tickHeading === 90) label = "E";
            else if (tickHeading === 180) label = "S";
            else if (tickHeading === 270) label = "W";
            else label = (tickHeading).toString().padStart(3, "0");

            ctx.save();
            ctx.font = "600 20px MSFS_LABEL";
            ctx.fillStyle = "#ff0";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.globalAlpha = 1.0;
            ctx.fillText(label, x, tapeTop + 20);
            ctx.restore();
        }

        ctx.save();
        ctx.strokeStyle = "red";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(canvasWidth / 2, tapeTop);
        ctx.lineTo(canvasWidth / 2, tapeTop + tapeHeight);
        ctx.stroke();
        ctx.restore();
    }

    drawHeadingTape(ctx) {
        //ctx.restore();
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

        if (this.altBugImg.complete && this.altBugImg.naturalWidth > 0) {
            ctx.save();
            ctx.translate(bugX, bugY);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(this.altBugImg, -imgW / 2, -imgH / 2, imgW, imgH);
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

    // drawAirspeedTape — draws V-speed bands as single arcs aligned to tick/label radius
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
        let showTakeoffSpeeds = false;
        if (vsFpm >= 0) {//if (aglFt < 2000 && vsFpm >= 0) {
            showTakeoffSpeeds = true;
        }
        //const showTakeoffSpeeds = isFinite(aglFt) && isFinite(vsFpm) && (aglFt < 2000) && (vsFpm => 0);

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
            if (!this.vSpeedShow || !this.vSpeedShow[bug.key]) continue;
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
            if (this.airspeedBug >= bot && this.airspeedBug <= top && this.altBugImg.complete && this.altBugImg.naturalWidth > 0) {
                const frac = (this.airspeedBug - bot) / (top - bot);
                const angle_deg = arc_start + frac * (arc_end - arc_start) + angle_offset;
                const angle = angle_deg * Math.PI / 180;
                const bug_radius = tape_radius - 10;
                const bug_x = cx + bug_radius * Math.cos(angle) - 15;
                const bug_y = cy + bug_radius * Math.sin(angle);
                ctx.save();
                ctx.translate(bug_x, bug_y);
                ctx.rotate(angle + Math.PI);
                ctx.drawImage(this.altBugImg, -7, -12, 15, 25);
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


    drawAirspeedBugBox(ctx) {
        const { x: boxX, y: boxY, w: boxW, h: boxH } = this.touchBoxes[0];
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

    /*drawDegreeSymbol(ctx, x, y, radius = 3) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.restore();
    }*/

    drawDegreeSymbol(ctx, x, y, radius = 3) {
        ctx.save();
        ctx.beginPath();
        // Use the radius provided
        ctx.arc(x, y, radius, 0, 2 * Math.PI);

        ctx.strokeStyle = "#fff"; // White outline
        ctx.lineWidth = 1.5;       // Set this to 0.5 for a very fine line
        ctx.globalAlpha = 0.85;

        ctx.stroke();             // STROKE instead of FILL makes it a ring
        ctx.restore();
    }

    drawHeadingBugBox(ctx) {
        const { x: boxX, y: boxY, w: boxW, h: boxH } = this.touchBoxes[3];

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
        if (!this.fdImg || this.fdImg.naturalWidth === 0) return;
        if (!this.fdActive) return;

        const fdImgW = 131;
        const fdImgH = 28;
        const fdImgX = 95;
        const fdImgY = 160;

        const fdCenterX = fdImgX + fdImgW / 2;
        const fdCenterY = fdImgY + fdImgH / 2;

        // These MUST match what drawHorizon() uses
        const aircraftPitchDeg = Number(this.pitch) || 0; // PLANE PITCH DEGREES
        const aircraftBankDeg = Number(this.bank) || 0;

        // FD values are already converted to degrees in getSimVars()
        // You said pitch is inverted -> invert once here (or in getSimVars, not both).
        //const fdPitchCmdDeg = -(Number(this.fdPitch) || 0);
        //const fdBankCmdDeg = (Number(this.fdBank) || 0);
        const fdPitchCmdDeg = -(Number(this.fdPitchSmooth) || 0);
        const fdBankCmdDeg = (Number(this.fdBankSmooth) || 0);

        // --- Error cues (commanded - actual) ---
        const pitchErrorDeg = fdPitchCmdDeg + aircraftPitchDeg;
        const bankErrorDeg = fdBankCmdDeg - aircraftBankDeg;

        // Convert pitch error into pixels.
        // If you want it to line up with your horizon ladder movement, start with 6.0 (same as drawHorizon)
        // and then tune down if it's too sensitive.
        const fdPixelsPerDeg = 6.0;

        // Canvas Y+ is down; positive pitch error means "need nose up" => bars should go UP => negative pixels.
        let pitchPixels = -pitchErrorDeg * fdPixelsPerDeg;

        // Clamp
        pitchPixels = Math.max(-80, Math.min(50, pitchPixels));

        ctx.save();
        ctx.translate(fdCenterX, fdCenterY + pitchPixels);
        ctx.rotate(-bankErrorDeg * Math.PI / 180);

        ctx.drawImage(this.fdImg, -fdImgW / 2, -fdImgH / 2, fdImgW, fdImgH);
        ctx.restore();
    }

    drawModeBar(ctx) {
        const barY = 220;
        const barH = 28;
        const lateralGreenX = 95;
        const apX = 125;
        const pitchGreenX = 187;
        const armedLateralX = 60;
        const armedPitchX = 235;

        // --- TRIGGER LOGIC ---
        // If we just switched to ALT, start the blinker
        if (this.pitchMode === "ALT" && !this.ALT_timer.ON && !this.altAlreadyCaptured) {
            this.ALT_timer.start();
            this.altAlreadyCaptured = true; // Flag to prevent re-triggering while still in ALT
        }
        // Reset flag if we leave ALT mode
        if (this.pitchMode !== "ALT") {
            this.altAlreadyCaptured = false;
            this.ALT_timer.stop();
        }

        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.font = "12px MSFS_LABEL";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // 1. Armed Lateral mode (white)
        if (this.armedLateralMode && this.armedLateralMode !== "") {
            ctx.fillStyle = "#ffffff";
            ctx.fillText(this.armedLateralMode, armedLateralX, barY + barH / 2);
        }

        // 2. Active Lateral mode (green)
        if (this.lateralMode && this.lateralMode !== "") {
            ctx.fillStyle = "#00ff00";
            ctx.fillText(this.lateralMode, lateralGreenX, barY + barH / 2);
        }

        // 3. AP/FD mode bar (center)
        if (this.autopilotMode && this.autopilotMode !== "") {
            ctx.fillStyle = "#00ff00";
            ctx.fillText(this.autopilotMode, apX, barY + barH / 2);
        }

        // 4. Active Pitch mode (WITH REVERSE VIDEO BLINK)
        if (this.pitchMode && this.pitchMode !== "") {
            let pitchTxt = this.pitchMode;

            // Build the text string
            if (this.pitchMode === "IAS" && this.airspeedBug !== undefined) {
                pitchTxt += " " + Math.round(this.airspeedBug).toString();
            } else if (this.pitchMode === "VS" && typeof this.apVS === "number") {
                let arrow = (this.apVS > 0.1) ? " ^" : (this.apVS < -0.1) ? " v" : "";
                let absVs = Math.abs(this.apVS) / 1000;
                let vsText = absVs > 0.01 ? " " + absVs.toFixed(1) : "";
                pitchTxt += arrow + vsText;
            } else if (this.pitchMode === "ALT" && this.capturedAltitude !== undefined) {
                pitchTxt += " " + Math.round(this.capturedAltitude).toString();
            }

            // Determine if we should show Reverse Video
            // count % 2 === 0 creates the "on/off" cycle
            let isAltCaptureBlinking = (this.pitchMode === "ALT" && this.ALT_timer.ON && this.ALT_timer.count % 2 === 0);

            if (isAltCaptureBlinking) {
                // Background Box (Green)
                ctx.fillStyle = "#00ff00";
                let txtWidth = ctx.measureText(pitchTxt).width + 4;
                ctx.fillRect(pitchGreenX - (txtWidth / 2), (barY + barH / 2) - 8, txtWidth, 16);

                // Text Color (Black)
                ctx.fillStyle = "#000000";
            } else {
                // Standard Text Color (Green)
                ctx.fillStyle = "#00ff00";
            }

            ctx.fillText(pitchTxt, pitchGreenX, barY + barH / 2);
        }

        // 5. Armed Pitch Mode (white, far right)
        if (this.armedPitchMode && this.armedPitchMode !== "") {
            ctx.fillStyle = "#ffffff";
            ctx.fillText(this.armedPitchMode, armedPitchX, barY + barH / 2);
        }

        ctx.restore();
    }


    drawTouchBoxes(ctx, onlyKnob = false) {
        const knobIds = new Set([
            "large_knob_ccw",
            "large_knob_cw",
            "small_knob_cw",
            "small_knob_ccw",
            "small_knob_button"
        ]);

        for (let i = 0; i < this.touchBoxes.length; i++) {
            const box = this.touchBoxes[i];

            // Always draw only knob boxes
            if (!knobIds.has(box.id)) continue;

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

    // Add this helper anywhere inside the PFD_screen class
    getOptionTextColors(label) {
        // Root menu: all white
        if (this.optionsLevel === 0) {
            return { first: "#ffffff", second: "#ffffff" };
        }

        // Child menus: default both lines cyan
        let first = "#26c6ff";
        let second = "#26c6ff";

        // Exceptions:
        if (label === "CDI") {
            // Value line reflects source: magenta for GPS, green for NAV1/NAV2
            second = this.getSourceColor();
        }
        if (label === "HDG" || label === "TRK" || label === "CRS" || label === "Vr" || label === "Vx" || label === "Vy" || label === "GLIDE" || label === "DH") {
            // Heading/Track bug value should remain white (not cyan)
            second = "#ffffff";
        }

        return { first, second };
    }

    // green selection box for minimums bug in Minimums menu
    drawMinimumsBugOnIndicator(ctx, label, box) {
        if (!this.showOptions || this.optionsLevel === 0 || this.optionsParent !== "Minimums") return;
        if (!box || label !== "Minimums Bug") return;
        if (!this.minimumsBugOn) return;

        ctx.save();
        ctx.fillStyle = "#00ff00";
        const pad = 6;
        const barH = 6;
        ctx.fillRect(box.x + pad, box.y + box.h - barH - 3, box.w - pad * 2, barH);
        ctx.restore();
    }

    // small helper to draw the green ON indicator inside a button box
    drawAirspeedOnIndicator(ctx, label, box) {
        if (!this.showOptions || this.optionsLevel === 0 || this.optionsParent !== "Airspeeds") return;
        if (!box || !label) return;
        if (!["Vr", "Vx", "Vy", "GLIDE"].includes(label)) return; // <--- CHANGED THIS LINE

        const key = label === "GLIDE" ? "Vg" : label; // <--- ADDED MAPPING
        const on = !!(this.vSpeedShow && this.vSpeedShow[key]); // <--- UPDATED THIS LINE
        if (!on) return;

        ctx.save();
        ctx.fillStyle = "#00ff00";
        const pad = 6;
        const barH = 6;
        ctx.fillRect(box.x + pad, box.y + box.h - barH - 3, box.w - pad * 2, barH);
        ctx.restore();
    }

    // ADD THIS MISSING FUNCTION HERE:
    drawMiscOnIndicator(ctx, label, box) {
        if (!this.showOptions || this.optionsLevel === 0 || this.optionsParent !== "Misc. Field") return;
        if (!box || !label) return;

        const miscMapping = { "TAS": 0, "GS": 1, "OAT": 2, "Wind": 3 };

        let isOn = false;
        if (label === "Off" && this.miscOption === -1) isOn = true;
        else if (label in miscMapping && this.miscOption === miscMapping[label]) isOn = true;

        if (!isOn) return;

        ctx.save();
        ctx.fillStyle = "#00ff00";
        const pad = 6;
        const barH = 6;
        ctx.fillRect(box.x + pad, box.y + box.h - barH - 3, box.w - pad * 2, barH);
        ctx.restore();
    }

    drawWindSettingOnIndicator(ctx, label, box) {
        if (!this.showOptions || this.optionsLevel === 0 || this.optionsParent !== "Wind Settings") return;
        if (!box || !label) return;

        const windMapping = { "<-MPH ^MPH": 0, "DEG MPH": 1, "<- MPH": 2 };

        // If the label matches the currently selected option, turn the indicator on
        if (label in windMapping && this.windOption === windMapping[label]) {
            ctx.save();
            ctx.fillStyle = "#00ff00";
            const pad = 6;
            const barH = 6;
            ctx.fillRect(box.x + pad, box.y + box.h - barH - 3, box.w - pad * 2, barH);
            ctx.restore();
        }
    }

    drawOptionsMenu(ctx) {
        if (!this.showOptions) return;

        if (!this.optionsImg || !this.optionsImg.complete || this.optionsImg.naturalWidth === 0) return;

        // Background image (ADI_options.png)
        ctx.drawImage(this.optionsImg, 0, 0, 320, 320);

        // Bottom title text
        const title = (this.optionsLevel === 0) ? "ADI Options" : this.optionsParent;
        ctx.save();
        ctx.font = "600 16px MSFS_LABEL";
        ctx.fillStyle = "#26c6ff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(title, 160, 285);
        ctx.restore();

        // Option list (skip Back for button list)
        const fullList = this.getCurrentOptionsList();
        const options = fullList.slice(1);

        // Visible window of 3 options
        const visibleCount = 3;

        // USE THE NEW WINDOW START LOGIC HERE:
        let startIndex = this.getOptionsWindowStart(options.length, visibleCount);

        const btnIds = ["options_btn_1", "options_btn_2", "options_btn_3", "options_btn_4"];

        ctx.save();
        ctx.font = "600 12px MSFS_LABEL";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (let i = 0; i < visibleCount; i++) {
            const optIndex = startIndex + i;
            if (optIndex >= options.length) break;

            const label = options[optIndex] || "";
            const box = this.touchBoxes.find(b => b.id === btnIds[i]);
            if (!box) continue;

            const selectedIndex = this.optionsSel - 1;
            const isSelected = (selectedIndex === optIndex);

            const isDisabled = (typeof this.isOptionDisabled === "function")
                ? this.isOptionDisabled(label)
                : false;

            // Border style (muted if disabled)
            ctx.lineWidth = 2;
            if (isDisabled) {
                ctx.strokeStyle = "rgba(180,180,180,0.6)";
            } else {
                ctx.strokeStyle = isSelected ? "#26c6ff" : "rgba(255,255,255,0.85)";
            }

            // Optional: grey fill overlay for disabled
            if (isDisabled) {
                ctx.save();
                ctx.globalAlpha = 0.35;
                ctx.fillStyle = "#000";
                this.drawRoundedRect(ctx, box.x, box.y, box.w, box.h, 6, "#000");
                ctx.restore();
            }

            this.drawRoundedRect(ctx, box.x, box.y, box.w, box.h, 6);

            const lines = this.getOptionLabelLines(label);
            const centerX = box.x + box.w / 2;
            const centerY = box.y + box.h / 2 + 2;

            // Determine colors per your rules
            let { first, second } = this.getOptionTextColors(label);

            // NEW: grey out text when disabled
            if (isDisabled) {
                first = "rgba(200,200,200,0.65)";
                second = "rgba(200,200,200,0.65)";
            }

            // Draw images for specific options, otherwise fall back to text
            if (label === "D->" && this.directToImg && this.directToImg.complete && this.directToImg.naturalWidth > 0) {
                ctx.save();
                if (isDisabled) ctx.globalAlpha = 0.4;
                const imgW = 44, imgH = 32; // Adjust dimensions to fit nicely inside the box
                ctx.drawImage(this.directToImg, centerX - imgW / 2, centerY - imgH / 2, imgW, imgH);
                ctx.restore();
            } else if (label === "Backlight" && this.backlightImg && this.backlightImg.complete && this.backlightImg.naturalWidth > 0) {
                ctx.save();
                if (isDisabled) ctx.globalAlpha = 0.4;
                const imgW = 54, imgH = 54; // Mostly square image
                // Shifted slightly up (-2) so it centers nicely in the bounding box
                ctx.drawImage(this.backlightImg, centerX - imgW / 2, centerY - imgH / 2 - 2, imgW, imgH);
                ctx.restore();
            } else {
                // Draw with specified colors
                this.drawOptionLabel(ctx, lines, centerX, centerY, first, second);
            }

            this.drawAirspeedOnIndicator(ctx, label, box);
            this.drawMinimumsBugOnIndicator(ctx, label, box);
            this.drawMiscOnIndicator(ctx, label, box);
            this.drawWindSettingOnIndicator(ctx, label, box);
            this.drawCrsDevsOnIndicator(ctx, label, box);
            this.drawNavPreviewOnIndicator(ctx, label, box);
        }

        ctx.restore();

        // Highlight Back button if selected
        const backBox = this.touchBoxes.find(b => b.id === "options_back");
        if (backBox) {
            ctx.save();
            ctx.lineWidth = 2;
            ctx.strokeStyle = (this.optionsSel === 0) ? "#26c6ff" : "rgba(255,255,255,0.85)";
            this.drawRoundedRect(ctx, backBox.x, backBox.y, backBox.w, backBox.h, 6);
            ctx.restore();
        }
    }

    drawRoundedRect(ctx, x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;

        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.stroke();
    }

    // Add this companion method next to the existing drawRoundedRect
    drawRoundedRectFill(ctx, x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;

        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fill();
    }

    // Shared helper: black box, label on top, value below
    drawMiscBox(ctx, label, valText) {
        const boxX = 80, boxY = 205;
        const boxW = 20, boxH = 20;
        const boxColor = "#000000";
        const textColor = "#fff";
        const fontSize = "8px MSFS_LABEL";

        ctx.save();
        ctx.beginPath();
        ctx.rect(boxX, boxY, boxW, boxH);
        ctx.fillStyle = boxColor;
        ctx.fill();

        ctx.font = fontSize;
        ctx.fillStyle = textColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, boxX + 10, boxY + 5, boxW, boxH);
        ctx.fillText(valText, boxX + 10, boxY + 15, boxW, boxH);
        ctx.restore();
    }

    // Returns "--" if the value is not a finite number or is 0
    _pfdValueText(value, unit) {
        const n = Math.round(value);
        if (typeof value !== "number" || !isFinite(n) || n === 0) return "--";
        return n + " " + unit;
    }

    drawOAT(ctx) {
        this.drawMiscBox(ctx, "OAT", this._pfdValueText(this.oat, "f"));
    }

    drawTAS(ctx) {
        this.drawMiscBox(ctx, "TAS", this._pfdValueText(this.TAS, "MPH"));
    }

    drawGS(ctx) {
        this.drawMiscBox(ctx, "GS", this._pfdValueText(this.GS, "MPH"));
    }

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

    drawWind(ctx) {
        if (this.windSpeed === 0 || this.isOnGround) return; // no wind or on the ground, no display

        const textColor = "#fff";

        // Wind relative to heading
        const windTrue = this.windDirection;              // AMBIENT WIND DIRECTION (true)
        const hdgMag = this.heading;                      // PLANE HEADING DEGREES MAGNETIC
        const magVar = this.magVar || 0;                  // MAGVAR (+East)
        const windMag = ((windTrue - magVar) % 360 + 360) % 360;
        const relativeDeg = ((windMag - hdgMag) % 360 + 360) % 360;
        const rad = relativeDeg * Math.PI / 180;

        const arrowCX = 85;    // center X of the drawing area
        const arrowCY = 211;   // center Y of the drawing area

        // --- black background box ---
        const bgX = 78;
        const bgY = 198;
        const bgW = 38;
        const bgH = 26;

        ctx.save();
        ctx.fillStyle = "#000";
        ctx.globalAlpha = 0.85;
        ctx.fillRect(bgX, bgY, bgW, bgH);
        ctx.restore();

        ctx.save();
        ctx.fillStyle = textColor;
        ctx.strokeStyle = textColor;

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

        if (this.windOption === 0) {
            // OPTION 0: "<-MPH ^MPH" (Crosswind and Headwind components).
            // Arrows are drawn manually (canvas paths) rather than with Unicode glyphs,
            // since the sim's text renderer shows a placeholder box for arrow characters.
            // Shifted +10px right so the arrows stay inside the black background box.
            ctx.font = "10px MSFS_LABEL";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";

            const hdgComp = Math.cos(rad) * this.windSpeed;
            const crsComp = Math.sin(rad) * this.windSpeed;

            // angle=0 draws downward, Math.PI/2 draws left, -Math.PI/2 draws right, Math.PI draws up.
            const crsArrowAngle = crsComp > 0 ? Math.PI / 2 : -Math.PI / 2;
            const hdgArrowAngle = hdgComp >= 0 ? Math.PI : 0;

            this._drawWindArrowGlyph(ctx, arrowCX + 2, arrowCY - 6, crsArrowAngle, 8);
            this._drawWindArrowGlyph(ctx, arrowCX + 2, arrowCY + 6, hdgArrowAngle, 8);

            ctx.fillText(String(Math.round(Math.abs(crsComp))), arrowCX + 9, arrowCY - 6);
            ctx.fillText(String(Math.round(Math.abs(hdgComp))), arrowCX + 9, arrowCY + 6);

        } else if (this.windOption === 1) {
            // OPTION 1: "DEG MPH" (Ambient wind direction over speed).
            // The degree mark is drawn manually (small ring) via drawDegreeSymbol,
            // since the "°" glyph does not render in the sim's text renderer.
            ctx.font = "10px MSFS_LABEL";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const dirStr = Math.round(windMag).toString().padStart(3, "0");
            const spdStr = Math.round(this.windSpeed).toString();

            ctx.fillText(dirStr, arrowCX + 5, arrowCY - 6);
            const dirMetrics = ctx.measureText(dirStr);
            const degX = arrowCX + 5 + (dirMetrics.width / 2) + 3;
            const degY = arrowCY - 8;
            this.drawDegreeSymbol(ctx, degX, degY, 1.5);

            ctx.fillText(spdStr, arrowCX + 5, arrowCY + 6);

        } else {
            // OPTION 2: arrow + speed
            const shaftLen = 10;
            const halfShaft = shaftLen / 2;
            const headLen = 4;
            const headHalf = 3;

            ctx.lineWidth = 1.2;

            ctx.save();
            ctx.translate(arrowCX, arrowCY);
            ctx.rotate(rad);

            // Shaft
            ctx.beginPath();
            ctx.moveTo(0, -halfShaft);
            ctx.lineTo(0, halfShaft);
            ctx.stroke();

            // Arrowhead
            ctx.beginPath();
            ctx.moveTo(0, halfShaft);
            ctx.lineTo(-headHalf, halfShaft - headLen);
            ctx.moveTo(0, halfShaft);
            ctx.lineTo(headHalf, halfShaft - headLen);
            ctx.stroke();
            ctx.restore();

            // Speed text
            ctx.font = "8px MSFS_LABEL";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(Math.round(this.windSpeed) + " KT", arrowCX + 10, arrowCY);
        }

        ctx.restore();
    }

    drawMisc(ctx) {
        // If set to -1 (Off), abort and draw nothing.
        if (this.miscOption === -1) return;

        if (this.miscOption === 0) this.drawTAS(ctx);
        else if (this.miscOption === 1) this.drawGS(ctx);
        else if (this.miscOption === 2) this.drawOAT(ctx);
        else if (this.miscOption === 3) this.drawWind(ctx);
    }

    drawCrsDevsOnIndicator(ctx, label, box) {
        if (!this.showOptions || this.optionsLevel === 0 || this.optionsParent !== "NAV Options") return;
        if (!box || label !== "CRS Devs") return;

        // Only draw if ON (1)
        if (this.courseDevs !== 1) return;

        ctx.save();
        ctx.fillStyle = "#00ff00";
        const pad = 6;
        const barH = 6;
        ctx.fillRect(box.x + pad, box.y + box.h - barH - 3, box.w - pad * 2, barH);
        ctx.restore();
    }

    drawNavPreviewOnIndicator(ctx, label, box) {
        if (!this.showOptions || this.optionsLevel === 0 || this.optionsParent !== "NAV Options") return;
        if (!box || label !== "CDI/VDI Preview") return;

        // Only draw if the preview feature is ON
        if (!this.cdiVdiPreviewOn) return;

        ctx.save();
        ctx.fillStyle = "#00ff00"; // Green color for "ON" state
        const pad = 6;
        const barH = 6;
        ctx.fillRect(box.x + pad, box.y + box.h - barH - 3, box.w - pad * 2, barH);
        ctx.restore();
    }

    getFlightPhaseLabel(idx) {
        switch (idx) {
            case -1: return "";       // raw data, no phase
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
            default: return "";
        }
    }

    // Add this new helper anywhere in the class (e.g., under other helpers)
    toggleCRSD() {
        this.courseDevs = !this.courseDevs;
        if (typeof SimVar !== "undefined") {
            // Bool type expects 1/0
            SimVar.SetSimVarValue("L:PFD_CrsDevs.1", "Number", this.courseDevs ? 1 : 0);
        }
        this.Update && this.Update();
    }

    // Add a small helper for source color (place near other helpers)
    getSourceColor() {
        // Magenta for GPS, green for VOR1/2
        return (this.selectedNavSource === "GPS") ? "#e049b0" : "#00ff00";
    }

    drawCDI(ctx, cx, cy, R) {
        if (!ctx) return;

        const showActive = !!this.navAvail;
        const showPreview = !!this.isPreviewActive;

        if (!showActive && !showPreview) return;

        const barX = 105, barY = 227, barW = 115, barH = 14;
        const textY = barY;
        const isGPS = (this.selectedNavSource === "GPS");
        const sourceColor = isGPS ? (this.identColor || "#e049b0") : "#00ff00";
        const midX = barX + barW / 2;
        const cdiMaxDots = 2;
        const spanPerDot = barW / (2 * cdiMaxDots);

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

        ctx.save();
        ctx.font = "600 12px MSFS_LABEL";
        ctx.fillStyle = sourceColor;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(this.navSourceText || "", x1 + 3, textY);
        ctx.fillText(this.phaseText || "", x2 + 3, textY);
        ctx.restore();

        const drawTriangle = (deflection, toFrom, color, isFilled) => {
            const normDots = Math.max(-127, Math.min(127, deflection)) / 127 * cdiMaxDots;
            let triX = Math.round(midX + normDots * spanPerDot);

            const triBaseW = 12;
            const triH = 10;
            const baseY = barY + barH - 2;

            triX = Math.max(barX + triBaseW / 2, Math.min(barX + barW - triBaseW / 2, triX));

            ctx.beginPath();
            if (toFrom === 2) {
                ctx.moveTo(triX, baseY + triH);
                ctx.lineTo(triX - triBaseW / 2, baseY);
                ctx.lineTo(triX + triBaseW / 2, baseY);
            } else {
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

        if (showPreview) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            drawTriangle(this.previewCdiDeflection, this.previewToFrom, this.lightBlue, false);
            ctx.restore();
        }

        if (showActive) {
            drawTriangle(this.cdiDeflection, Math.round(this.toFromFlag), sourceColor, true);
        }
    }

    drawVDI(ctx, cx, cy, R) {
        const showActive = !!this.vtgValid && !!this.vtgType;
        const showPreview = !!this.isPreviewActive && !!this.previewVtgValid;

        if (!showActive && !showPreview) return;

        const tapeWidth = 16;
        const tapeHeight = R * 1.18;
        const tapeX = cx + R * 0.25;
        const tapeY = cy - tapeHeight / 2 - 2;

        const img = this.images.vdiImg;
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, tapeX, tapeY, tapeWidth, tapeHeight);
        }

        const isGPS = (this.selectedNavSource === "GPS");
        const activeColor = isGPS ? (this.identColor || "#e049b0") : "#00ff00";
        const topChar = showActive ? ((this.vtgType === "VNAV") ? "V" : "G") : "G";
        const topCharColor = showActive ? activeColor : this.lightBlue;

        ctx.save();
        ctx.font = "600 15px MSFS_LABEL";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = topCharColor;
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.fillText(topChar, tapeX + tapeWidth / 2, tapeY + 0);
        ctx.restore();

        const dotsTotal = 2.2;
        const dotSpacing = tapeHeight / 6;
        const verticalFineTune = 12;

        const drawMarker = (deflection, color, isFilled, isVnav) => {
            let defl = Math.max(-127, Math.min(127, deflection)) / 127 * dotsTotal;
            defl = Math.max(-dotsTotal, Math.min(dotsTotal, defl));

            const markerY = tapeY + tapeHeight / 2 + defl * dotSpacing + verticalFineTune;

            ctx.save();
            ctx.translate(tapeX + tapeWidth / 2, markerY);

            if (isVnav) {
                ctx.beginPath();
                ctx.moveTo(-7, 0);
                ctx.lineTo(7, -9);
                ctx.moveTo(-7, 0);
                ctx.lineTo(7, 9);
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.shadowColor = "black";
                ctx.shadowBlur = 2;
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.moveTo(0, -7);
                ctx.lineTo(7, 0);
                ctx.lineTo(0, 7);
                ctx.lineTo(-7, 0);
                ctx.closePath();

                if (isFilled) {
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = "#222";
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

        if (showPreview) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            drawMarker(this.previewVdiDeflection, this.lightBlue, false, false);
            ctx.restore();
        }

        if (showActive) {
            drawMarker(this.vdiDeflection, activeColor, true, this.vtgType === "VNAV");
        }
    }

    drawDebugText(ctx) {
        if (!ctx) return;

        const text = String(this.debugText || "");
        if (!text) return;

        // Cycle weights using debugCnt
        // (Some weights may render identically if Malgun doesn't expose that face in MSFS runtime.)
        const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];

        const cnt = Number.isFinite(this.debugCnt) ? this.debugCnt : 0;
        const idx = ((cnt % weights.length) + weights.length) % weights.length;
        const weight = weights[idx];

        const sizePx = 12;
        const family = "MSFS_LABEL";
        const fontSpec = `${weight} ${sizePx}px "${family}"`;

        // Show current weight so you can verify cycling
        const display = `${text}  [${family} ${weight}]`;

        ctx.save();
        ctx.font = fontSpec;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const x = 8, y = 8, pad = 4;
        const metrics = ctx.measureText(display);
        const w = Math.ceil(metrics.width) + pad * 2;
        const h = (sizePx + 2) + pad * 2;

        ctx.globalAlpha = 0.75;
        ctx.fillStyle = "#000";
        ctx.fillRect(x, y, w, h);

        ctx.globalAlpha = 1.0;
        ctx.fillStyle = "#00ff00";
        ctx.fillText(display, x + pad, y + pad);

        ctx.restore();
    }

    drawNav(ctx, cx, cy, R) {
        if (!this.courseDevs) return;

        this.drawCDI(ctx, cx, cy, R);
        this.drawVDI(ctx, cx, cy, R);
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

    drawPowerUpScreen(ctx) {
        if (!this.canvas) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const remainingMs = Math.max(0, this.powerUpDelayMs - (Date.now() - this.powerUpStartMs));
        const seconds = Math.ceil(remainingMs / 1000);

        ctx.save();

        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 22px Arial";
        ctx.fillText("INITIALIZING", w / 2, h / 2 - 10);

        ctx.fillStyle = "#26c6ff";
        ctx.font = "bold 16px Arial";
        ctx.fillText(`${seconds}s`, w / 2, h / 2 + 20);

        ctx.restore();
    }

    drawTrimAdvisory(ctx) {
        if (!this.trimCue) return;

        const text = this.trimCue;
        const centerX = this.canvas.width / 2;
        const y = 198; // just above the mode bar

        ctx.save();
        ctx.font = "bold 14px MSFS_LABEL";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const metrics = ctx.measureText(text);
        const padX = 10;
        const w = metrics.width + padX * 2;
        const h = 20;
        const x = centerX - w / 2;

        ctx.fillStyle = "#f2e200";
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        ctx.fillStyle = "#000000";
        ctx.fillText(text, centerX, y + h / 2);

        ctx.restore();
    }

    drawPFD() {
        const ctx = this.canvas.getContext('2d');
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const w = this.canvas.width - 50, h = this.canvas.height;
        const cx = (w / 2) + 60, cy = h / 2;
        const R = Math.min(w, h) * 0.43;

        this.getSimVars();

        if (!this.pfdPowered) {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            return;
        }

        if (this.powerUpActive) {
            this.drawPowerUpScreen(ctx);
            return;
        }

        this.drawHorizon(ctx);
        this.drawBank(ctx);
        this.drawSlipSkidIndicator(ctx);
        this.drawFlightDirector(ctx);
        this.drawTapeShade(ctx);
        this.drawAltitudeTape(ctx);
        this.drawVerticalSpeedIndicator(ctx, cx, cy, R);
        this.drawAirspeedTape(ctx);
        this.drawCurrentAltitudeBox(ctx, cx, cy, R);
        this.drawCurrentAirspeedBox(ctx, cx, cy, R);
        this.drawOverlay(ctx);
        this.drawTouchHighlight(ctx);
        this.drawAirspeedBugBox(ctx);
        this.drawAltitudeSelectBox(ctx);
        this.drawHeadingBugBox(ctx);
        this.drawBaro(ctx);
        this.drawMisc(ctx);
        this.drawTrimAdvisory(ctx);//doesn't work
        this.drawModeBar(ctx);
        this.drawHeadingTape(ctx);
        this.drawNav(ctx, cx, cy, R);
        this.drawOptionsMenu(ctx);
        this.drawBezel(ctx);
        this.drawTouchBoxes(ctx, false);
        const effectiveBrightness = Math.max(0, Math.min(1, this.screenBrightness - this.PFD_dimming));
        this.drawDimOverlay(ctx, this.canvas.width, this.canvas.height, effectiveBrightness);

        //this.debugText = "TEST";
        //this.drawDebugText(ctx);
    }

    Update() {
        // --- Timeout Auto-Revert Logic ---
        if (Date.now() - this.lastInteractionTime > 60000) {

            // Revert selected box to baro (3)
            if (this.touchSelected !== 3) {
                this.touchSelected = 3;
            }

            // Auto-close options menu if left open
            if (this.showOptions) {
                this.showOptions = false;
                this._resetTouchLayout();
            }
        }

        // Draw the screen as usual
        this.drawPFD();
    }
}

if (typeof registerInstrument === 'function') {
    registerInstrument("custom-pfd-gauge", PFD_screen);
}