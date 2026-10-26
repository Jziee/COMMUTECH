/* COMMUTECH prototype
   1) Replace both placeholders below with your Supabase Project URL and publishable key.
   2) Never put a Supabase secret/service_role key in browser code.
*/
(() => {
  "use strict";

  const SUPABASE_URL = "https://svxmrdbkwjgcgxwazrtq.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mr-KuyV8oVSFJqwquh2wsw_zOVdnXnc";
  const VEHICLE_ID = "limay-001";
  const TABLE = "vehicle_status";
  const DEFAULT_CAPACITY = 20;

  const $ = (id) => document.getElementById(id);
  const isConfigured = () =>
    SUPABASE_URL.startsWith("https://") &&
    !SUPABASE_URL.includes("YOUR_SUPABASE") &&
    SUPABASE_PUBLISHABLE_KEY &&
    !SUPABASE_PUBLISHABLE_KEY.includes("YOUR_SUPABASE");

  let supabase = null;
  let toastTimer = null;

  function showToast(message) {
    const el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
  }

  function setMessage(id, message, type = "") {
    const el = $(id);
    if (!el) return;
    el.textContent = message;
    el.classList.remove("error", "success");
    if (type) el.classList.add(type);
  }

  function setConnection(label, connected) {
    const el = $("connection-label");
    if (el) el.textContent = label;
    const pulse = document.querySelector(".pulse");
    if (pulse) {
      pulse.style.background = connected ? "var(--green)" : "var(--orange)";
      pulse.style.boxShadow = connected
        ? "0 0 0 4px rgba(87,214,160,.1)"
        : "0 0 0 4px rgba(255,189,105,.1)";
    }
    const db = $("db-status");
    if (db) {
      db.textContent = label === "LIVE" ? "Connected" : label === "ERROR" ? "Connection error" : "Connecting…";
      db.classList.toggle("neutral-text", !connected);
    }
  }

  function initSupabase() {
    if (!isConfigured()) {
      setConnection("SETUP NEEDED", false);
      setMessage("login-message", "Add your Supabase Project URL and publishable key in app.js first.", "error");
      const db = $("db-status");
      if (db) db.textContent = "Credentials needed";
      return false;
    }
    if (!window.supabase || !window.supabase.createClient) {
      setConnection("ERROR", false);
      showToast("Supabase client did not load. Check your internet connection.");
      return false;
    }
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return true;
  }

  function asInt(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  function formatTime(value) {
    if (!value) return "No update time";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function timeAgo(value) {
    if (!value) return "—";
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (!Number.isFinite(seconds)) return "—";
    if (seconds < 5) return "Just now";
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  function occupancy(row) {
    const count = Math.max(0, asInt(row?.passenger_count, 0));
    const capacity = Math.max(1, asInt(row?.capacity, DEFAULT_CAPACITY));
    const available = Math.max(0, capacity - count);
    const pct = Math.min(100, Math.round((count / capacity) * 100));
    return { count, capacity, available, pct };
  }

  async function getVehicle() {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, passenger_count, capacity, latitude, longitude, tracking_active, updated_at")
      .eq("id", VEHICLE_ID)
      .single();
    if (error) throw error;
    return data;
  }

  async function updateVehicle(patch) {
    const payload = { ...patch, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from(TABLE)
      .update(payload)
      .eq("id", VEHICLE_ID)
      .select("id, passenger_count, capacity, latitude, longitude, tracking_active, updated_at")
      .single();
    if (error) throw error;
    return data;
  }

  // PUBLIC DASHBOARD
  let map = null;
  let marker = null;
  let commuterMarker = null;
  let commuterLocation = null;
  let lastRow = null;
  let previousVehicleFix = null;
  let estimatedVehicleSpeedKmh = 20; // Fallback estimate until enough GPS movement is observed.
  let commuterWatchId = null;

  function initMap() {
    if (!window.L || !$("map")) return;
    map = L.map("map", { scrollWheelZoom: false }).setView([14.55, 120.60], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    const vehicleIcon = L.divIcon({
      className: "commutech-marker-wrap",
      html: '<div style="width:36px;height:36px;border:3px solid white;border-radius:50% 50% 50% 8px;transform:rotate(-45deg);background:linear-gradient(135deg,#62e0d1,#65a7ff);box-shadow:0 5px 20px #14263b80;display:grid;place-items:center"><span style="transform:rotate(45deg);color:#081522;font-weight:900;font-size:16px">C</span></div>',
      iconSize: [36, 36],
      iconAnchor: [18, 36]
    });
    marker = L.marker([14.55, 120.60], { icon: vehicleIcon });
    const commuterIcon = L.divIcon({
      className: "commuter-marker-wrap",
      html: '<div style="width:20px;height:20px;border:4px solid white;border-radius:50%;background:#3987ff;box-shadow:0 2px 12px #14263b80"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    // The commuter marker is added only after the commuter grants location permission.
    window.commutechCommuterIcon = commuterIcon;
    $("center-map")?.addEventListener("click", () => {
      if (lastRow && validCoordinates(lastRow.latitude, lastRow.longitude)) {
        map.setView([lastRow.latitude, lastRow.longitude], 16, { animate: true });
      } else {
        map.setView([14.55, 120.60], 11);
        showToast("No GPS position has been received yet.");
      }
    });
  }

  function validCoordinates(lat, lng) {
    return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
      Number(lat) >= -90 && Number(lat) <= 90 &&
      Number(lng) >= -180 && Number(lng) <= 180;
  }

  function renderDashboard(row) {
    if (!row) return;
    lastRow = row;
    const o = occupancy(row);
    if ($("passenger-count")) $("passenger-count").textContent = o.count;
    if ($("available-seats")) $("available-seats").textContent = o.available;
    if ($("capacity-label")) $("capacity-label").textContent = `${o.capacity} seats`;
    if ($("occupancy-bar")) $("occupancy-bar").style.width = `${o.pct}%`;
    if ($("occupancy-percent")) $("occupancy-percent").textContent = `${o.pct}%`;
    if ($("occupancy-caption")) $("occupancy-caption").textContent = o.count >= o.capacity ? "At capacity" : `${o.count} of ${o.capacity} occupied`;
    if ($("last-updated")) $("last-updated").textContent = `Updated ${timeAgo(row.updated_at)}`;
    if ($("update-age")) $("update-age").textContent = timeAgo(row.updated_at);

    const tracking = Boolean(row.tracking_active);
    if ($("tracking-status")) $("tracking-status").textContent = tracking ? "Active" : "Inactive";
    if ($("tracking-detail")) $("tracking-detail").textContent = tracking ? "The driver is sharing GPS location." : "The driver has not started GPS sharing.";
    if ($("tracking-dot")) $("tracking-dot").classList.toggle("active", tracking);

    if (validCoordinates(row.latitude, row.longitude)) {
      const lat = Number(row.latitude), lng = Number(row.longitude);
      if (marker && map) {
        marker.setLatLng([lat, lng]);
        if (!map.hasLayer(marker)) marker.addTo(map);
        marker.bindPopup(`<strong>COMMUTECH · LIMAY-001</strong><br>${lat.toFixed(5)}, ${lng.toFixed(5)}<br>${o.count}/${o.capacity} passengers`);
        if (!map._commutechCentered) {
          map.setView([lat, lng], 15);
          map._commutechCentered = true;
        }
      }
      if ($("location-text")) $("location-text").textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if ($("coordinate-text")) $("coordinate-text").textContent = `Latitude ${lat.toFixed(5)} · Longitude ${lng.toFixed(5)}`;
      if ($("gps-status")) $("gps-status").textContent = tracking ? "Live" : "Last known";

      // Estimate vehicle speed from consecutive GPS fixes when available.
      const fixTime = Date.now();
      if (previousVehicleFix) {
        const elapsedHours = (fixTime - previousVehicleFix.time) / 3600000;
        if (elapsedHours > 0 && elapsedHours < 0.25) {
          const movedKm = distanceKm(previousVehicleFix.lat, previousVehicleFix.lng, lat, lng);
          const observedSpeed = movedKm / elapsedHours;
          // Ignore stationary GPS drift and implausible jumps.
          if (observedSpeed >= 5 && observedSpeed <= 80) {
            estimatedVehicleSpeedKmh = Math.round(estimatedVehicleSpeedKmh * 0.35 + observedSpeed * 0.65);
          }
        }
      }
      previousVehicleFix = { lat, lng, time: fixTime };
    } else {
      if ($("location-text")) $("location-text").textContent = "Location unavailable";
      if ($("coordinate-text")) $("coordinate-text").textContent = "Waiting for GPS coordinates";
      if ($("gps-status")) $("gps-status").textContent = "Not received";
    }
    updateEta();
  }

  function distanceKm(lat1, lon1, lat2, lon2) {
    const toRad = (degrees) => degrees * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function updateEta() {
    const etaValue = $("eta-value");
    const etaNotice = $("eta-notice");
    const etaDistance = $("eta-distance");
    if (!etaValue) return;

    if (!commuterLocation) {
      etaValue.textContent = "Locate yourself first";
      if (etaDistance) etaDistance.textContent = "Your location stays on this device.";
      if (etaNotice) etaNotice.textContent = "Tap Locate Me and allow location access. ETA is an approximate estimate, not a guaranteed arrival time.";
      return;
    }
    if (!lastRow || !lastRow.tracking_active || !validCoordinates(lastRow.latitude, lastRow.longitude)) {
      etaValue.textContent = "Waiting for vehicle GPS";
      if (etaDistance) etaDistance.textContent = "The driver must start GPS sharing.";
      if (etaNotice) etaNotice.textContent = "ETA appears when both your location and the vehicle's live GPS are available.";
      return;
    }

    const straightKm = distanceKm(
      commuterLocation.latitude, commuterLocation.longitude,
      Number(lastRow.latitude), Number(lastRow.longitude)
    );
    // A simple road-distance factor makes the estimate less optimistic than straight-line distance.
    const estimatedRoadKm = straightKm * 1.25;
    const speed = Math.max(8, Math.min(45, estimatedVehicleSpeedKmh || 20));
    const minutes = Math.max(1, Math.round((estimatedRoadKm / speed) * 60));
    etaValue.textContent = straightKm < 0.08 ? "Very close — check the map" : `About ${minutes} min`;
    if (etaDistance) etaDistance.textContent = `${estimatedRoadKm.toFixed(1)} km estimated road distance · ${speed} km/h assumed speed`;
    if (etaNotice) etaNotice.textContent = "Prototype estimate based on GPS distance and an estimated speed. It does not account for the actual road route, traffic, stops, or the vehicle's direction, so use it as a rough guide only.";
  }

  function locateCommuter() {
    if (!navigator.geolocation) {
      showToast("This browser does not support location services.");
      return;
    }
    if (!window.isSecureContext) {
      showToast("Your location requires HTTPS or localhost. Open the deployed website over HTTPS.");
      return;
    }
    if (commuterWatchId !== null) return;
    const button = $("locate-me");
    if (button) {
      button.disabled = true;
      button.textContent = "Locating…";
    }
    if ($("commuter-location-status")) $("commuter-location-status").textContent = "Waiting for location permission…";
    commuterWatchId = navigator.geolocation.watchPosition((position) => {
      commuterLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      if (map && window.commutechCommuterIcon) {
        if (!commuterMarker) {
          commuterMarker = L.marker(
            [commuterLocation.latitude, commuterLocation.longitude],
            { icon: window.commutechCommuterIcon, zIndexOffset: 1000 }
          ).addTo(map);
          commuterMarker.bindPopup("<strong>Your location</strong><br>This marker is only shown on your device.");
        } else {
          commuterMarker.setLatLng([commuterLocation.latitude, commuterLocation.longitude]);
          if (!map.hasLayer(commuterMarker)) commuterMarker.addTo(map);
        }
      }
      if ($("commuter-location-status")) {
        $("commuter-location-status").textContent = `Location found · accuracy ±${Math.round(position.coords.accuracy)} m`;
      }
      if (button) {
        button.disabled = false;
        button.textContent = "Refresh my location";
      }
      if (map && marker) {
        const points = [L.latLng(commuterLocation.latitude, commuterLocation.longitude)];
        if (lastRow && validCoordinates(lastRow.latitude, lastRow.longitude)) {
          points.push(L.latLng(Number(lastRow.latitude), Number(lastRow.longitude)));
        }
        if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 15 });
        else map.setView(points[0], 15);
      }
      updateEta();
    }, (error) => {
      let message = "Could not get your location.";
      if (error.code === 1) message = "Location permission was denied. Enable location access in your browser settings.";
      if (error.code === 2) message = "Your location is unavailable. Try again outdoors.";
      if (error.code === 3) message = "Location request timed out. Try again.";
      if ($("commuter-location-status")) $("commuter-location-status").textContent = message;
      if (button) {
        button.disabled = false;
        button.textContent = "Try Locate Me Again";
      }
      commuterWatchId = null;
      showToast(message);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    showToast("Location access requested. Your location is not sent to Supabase.");
  }

  async function initDashboard() {
    initMap();
    $("locate-me")?.addEventListener("click", locateCommuter);
    if (!initSupabase()) return;
    try {
      const row = await getVehicle();
      renderDashboard(row);
      setConnection("LIVE", true);
    } catch (error) {
      console.error(error);
      setConnection("ERROR", false);
      showToast(`Could not load vehicle data: ${error.message || "check Supabase settings"}`);
      return;
    }
    supabase.channel("vehicle-status-dashboard")
      .on("postgres_changes", {
        event: "*", schema: "public", table: TABLE, filter: `id=eq.${VEHICLE_ID}`
      }, (payload) => {
        if (payload.new) renderDashboard(payload.new);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnection("LIVE", true);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnection("ERROR", false);
      });
  }

  // DRIVER CONTROL PANEL
  let gpsWatchId = null;
  let lastGpsWrite = 0;
  let currentDriver = null;
  let driverRow = null;
  let savingPassenger = false;

  function renderDriver(row) {
    if (!row) return;
    driverRow = row;
    const o = occupancy(row);
    if ($("driver-count")) $("driver-count").textContent = o.count;
    if ($("driver-occupancy-bar")) $("driver-occupancy-bar").style.width = `${o.pct}%`;
    if ($("driver-capacity-copy")) $("driver-capacity-copy").textContent = `Capacity: ${o.capacity}`;
    if ($("driver-remaining")) $("driver-remaining").textContent = `${o.available} seats available`;
    if ($("minus-passenger")) $("minus-passenger").disabled = savingPassenger || o.count <= 0;
    if ($("plus-passenger")) $("plus-passenger").disabled = savingPassenger || o.count >= o.capacity;
    if ($("reset-count")) $("reset-count").disabled = savingPassenger || o.count === 0;
    if (validCoordinates(row.latitude, row.longitude) && $("driver-coordinates")) {
      $("driver-coordinates").textContent = `${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)}`;
    }
    if ($("driver-gps-dot")) $("driver-gps-dot").classList.toggle("active", Boolean(row.tracking_active));
    if ($("driver-gps-status")) $("driver-gps-status").textContent = row.tracking_active ? "Tracking active" : "Not sharing location";
    if ($("driver-gps-detail") && !gpsWatchId) $("driver-gps-detail").textContent = row.tracking_active ? "Database says tracking is active." : "Allow location access when prompted.";
  }

  function showDriverPanel(user) {
    currentDriver = user;
    $("login-panel")?.classList.add("hidden");
    $("driver-panel")?.classList.remove("hidden");
    if ($("driver-email")) $("driver-email").textContent = user.email || "Authenticated driver";
    loadDriverRow();
  }

  function showLoginPanel() {
    currentDriver = null;
    $("driver-panel")?.classList.add("hidden");
    $("login-panel")?.classList.remove("hidden");
  }

  async function loadDriverRow() {
    try {
      const row = await getVehicle();
      renderDriver(row);
      setMessage("occupancy-message", "Vehicle data loaded.", "success");
    } catch (error) {
      console.error(error);
      setMessage("occupancy-message", `Could not load vehicle data: ${error.message}`, "error");
    }
  }

  async function changePassengerCount(delta) {
    if (!driverRow || savingPassenger) return;
    const o = occupancy(driverRow);
    const next = Math.max(0, Math.min(o.capacity, o.count + delta));
    if (next === o.count) {
      showToast(next === 0 ? "Passenger count cannot go below zero." : "Vehicle is already at capacity.");
      return;
    }
    savingPassenger = true;
    renderDriver(driverRow);
    setMessage("occupancy-message", "Saving passenger count…");
    try {
      const updated = await updateVehicle({ passenger_count: next });
      renderDriver(updated);
      setMessage("occupancy-message", "Passenger count updated and synced to the dashboard.", "success");
    } catch (error) {
      console.error(error);
      setMessage("occupancy-message", `Update failed: ${error.message}`, "error");
      showToast("Passenger update failed. Check the driver policy and connection.");
    } finally {
      savingPassenger = false;
      if (driverRow) renderDriver(driverRow);
    }
  }

  async function resetPassengerCount() {
    if (!driverRow || savingPassenger) return;
    savingPassenger = true;
    try {
      const updated = await updateVehicle({ passenger_count: 0 });
      renderDriver(updated);
      setMessage("occupancy-message", "Passenger count reset to zero.", "success");
    } catch (error) {
      setMessage("occupancy-message", `Reset failed: ${error.message}`, "error");
    } finally {
      savingPassenger = false;
      if (driverRow) renderDriver(driverRow);
    }
  }

  async function startGps() {
    if (!navigator.geolocation) {
      showToast("This browser does not support geolocation.");
      return;
    }
    if (!window.isSecureContext) {
      showToast("GPS requires HTTPS or localhost. Deploy the site over HTTPS first.");
      return;
    }
    if (gpsWatchId !== null) return;
    try {
      await updateVehicle({ tracking_active: true });
    } catch (error) {
      showToast(`Could not start tracking: ${error.message}`);
      return;
    }
    $("start-gps").disabled = true;
    $("stop-gps").disabled = false;
    if ($("driver-gps-status")) $("driver-gps-status").textContent = "Requesting GPS permission…";
    if ($("driver-gps-detail")) $("driver-gps-detail").textContent = "Allow location access in your browser.";
    gpsWatchId = navigator.geolocation.watchPosition(async (position) => {
      const now = Date.now();
      if (now - lastGpsWrite < 4000) return; // Limit database writes to about one per 4 seconds.
      lastGpsWrite = now;
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      if ($("driver-coordinates")) $("driver-coordinates").textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      if ($("driver-gps-status")) $("driver-gps-status").textContent = "GPS fix received";
      if ($("driver-gps-detail")) $("driver-gps-detail").textContent = `Accuracy about ${Math.round(position.coords.accuracy)} m`;
      try {
        const row = await updateVehicle({ latitude, longitude, tracking_active: true });
        renderDriver(row);
        if ($("driver-gps-status")) $("driver-gps-status").textContent = "Sharing live location";
      } catch (error) {
        console.error(error);
        setMessage("occupancy-message", `GPS received but database update failed: ${error.message}`, "error");
      }
    }, (error) => {
      let message = "Unable to get GPS location.";
      if (error.code === 1) message = "Location permission denied. Enable location permission for this site in browser settings.";
      if (error.code === 2) message = "GPS position unavailable. Try moving outdoors and retry.";
      if (error.code === 3) message = "GPS request timed out. Keep the phone near a window or outdoors.";
      if ($("driver-gps-status")) $("driver-gps-status").textContent = "GPS unavailable";
      if ($("driver-gps-detail")) $("driver-gps-detail").textContent = message;
      showToast(message);
      stopGps(false);
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    showToast("GPS tracking started. Allow location access if prompted.");
  }

  async function stopGps(updateDatabase = true) {
    if (gpsWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchId);
    }
    gpsWatchId = null;
    if ($("start-gps")) $("start-gps").disabled = false;
    if ($("stop-gps")) $("stop-gps").disabled = true;
    if (updateDatabase && supabase && currentDriver) {
      try {
        const row = await updateVehicle({ tracking_active: false });
        renderDriver(row);
      } catch (error) {
        console.error(error);
        showToast(`GPS stopped on this phone, but database status could not be updated: ${error.message}`);
      }
    }
    if ($("driver-gps-status")) $("driver-gps-status").textContent = "Not sharing location";
    if ($("driver-gps-detail")) $("driver-gps-detail").textContent = "GPS updates have stopped.";
  }

  async function initDriver() {
    if (!initSupabase()) return;
    $("login-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = $("email").value.trim();
      const password = $("password").value;
      const button = $("login-button");
      button.disabled = true;
      setMessage("login-message", "Signing in…");
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMessage("login-message", "");
        showDriverPanel(data.user);
      } catch (error) {
        console.error(error);
        setMessage("login-message", error.message || "Sign-in failed.", "error");
      } finally {
        button.disabled = false;
      }
    });

    $("plus-passenger")?.addEventListener("click", () => changePassengerCount(1));
    $("minus-passenger")?.addEventListener("click", () => changePassengerCount(-1));
    $("reset-count")?.addEventListener("click", resetPassengerCount);
    $("refresh-count")?.addEventListener("click", loadDriverRow);
    $("start-gps")?.addEventListener("click", startGps);
    $("stop-gps")?.addEventListener("click", () => stopGps(true));
    $("logout-button")?.addEventListener("click", async () => {
      await stopGps(true);
      const { error } = await supabase.auth.signOut();
      if (error) showToast(`Sign-out failed: ${error.message}`);
      showLoginPanel();
    });

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) showDriverPanel(session.user);
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session?.user) showLoginPanel();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (document.body.dataset.page === "dashboard") initDashboard();
    if (document.body.dataset.page === "driver") initDriver();
  });
})();
