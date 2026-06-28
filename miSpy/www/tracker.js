// tracker.js — distance tracking with a native/web split.
// Native (Capacitor): @capgo/background-geolocation foreground service.
// Web (browser dev): navigator.geolocation.watchPosition.

const EARTH_R = 6371000;            // meters
const MIN_STEP_M = 5;               // ignore GPS jitter below this
const MAX_ACC_M = 50;               // drop fixes less accurate than this
const M_PER_MILE = 1609.344;

function haversine(a, b) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

export class Tracker {
  constructor({ onUpdate, onError } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this.onError = onError || (() => {});
    this.meters = 0;
    this.last = null;       // last accepted {lat,lng,t}
    this.points = [];
    this._watchId = null;
    this._plugin = null;
    this._native = isNative();
  }

  get miles() { return this.meters / M_PER_MILE; }

  _accept(lat, lng, acc, speed, t) {
    if (typeof acc === 'number' && acc > MAX_ACC_M) return; // too noisy
    const fix = { lat, lng, t: t || Date.now() };
    if (this.last) {
      const step = haversine(this.last, fix);
      if (step < MIN_STEP_M) return;   // jitter while stationary
      this.meters += step;
    }
    this.last = fix;
    this.points.push({ lat, lng, t: fix.t, acc });
    const mph = typeof speed === 'number' && speed >= 0 ? speed * 2.23694 : 0;
    this.onUpdate({ meters: this.meters, miles: this.miles, mph, point: this.points[this.points.length - 1] });
  }

  async start() {
    this.meters = 0; this.last = null; this.points = [];
    if (this._native) return this._startNative();
    return this._startWeb();
  }

  async _startNative() {
    // Native plugin registers itself; no bundler import needed.
    this._plugin = window.Capacitor.registerPlugin('BackgroundGeolocation');
    this._watchId = await this._plugin.addWatcher(
      {
        backgroundTitle: 'miSpy is tracking mileage',
        backgroundMessage: 'Tap to return to the app',
        requestPermissions: true,
        stale: false,
        distanceFilter: MIN_STEP_M
      },
      (location, error) => {
        if (error) { this.onError(error); return; }
        if (!location) return;
        this._accept(location.latitude, location.longitude, location.accuracy, location.speed, location.time);
      }
    );
  }

  _startWeb() {
    if (!navigator.geolocation) { this.onError(new Error('Geolocation unavailable')); return; }
    this._watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        this._accept(c.latitude, c.longitude, c.accuracy, c.speed, pos.timestamp);
      },
      (err) => this.onError(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }

  async stop() {
    try {
      if (this._native && this._plugin && this._watchId != null) {
        await this._plugin.removeWatcher({ id: this._watchId });
      } else if (this._watchId != null) {
        navigator.geolocation.clearWatch(this._watchId);
      }
    } catch (e) { /* ignore */ }
    this._watchId = null;
    return { meters: this.meters, miles: this.miles, points: this.points };
  }
}
