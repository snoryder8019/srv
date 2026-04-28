const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Grab a single JPEG frame from an RTSP stream using ffmpeg.
 * @param {Object} camera - { ip, username, password, path }
 * @returns {Promise<Buffer>} JPEG image buffer
 */
function captureFrame(camera) {
  return new Promise((resolve, reject) => {
    const rtspUrl = `rtsp://${camera.username}:${camera.password}@${camera.ip}${camera.path || '/cam/realmonitor?channel=1&subtype=1'}`;
    const tmpFile = path.join(os.tmpdir(), `dart-frame-${Date.now()}.jpg`);

    const args = [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-frames:v', '1',
      '-q:v', '2',
      '-y',
      tmpFile
    ];

    const proc = execFile('ffmpeg', args, { timeout: 10000 }, (err) => {
      if (err) {
        // Clean up on error
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        return reject(new Error('Failed to capture frame: ' + err.message));
      }

      try {
        const buf = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);
        resolve(buf);
      } catch (readErr) {
        reject(new Error('Failed to read captured frame: ' + readErr.message));
      }
    });
  });
}

/**
 * Grab a frame and return as base64.
 * @param {Object} camera - { ip, username, password, path }
 * @returns {Promise<string>} base64-encoded JPEG
 */
async function captureFrameBase64(camera) {
  const buf = await captureFrame(camera);
  return buf.toString('base64');
}

module.exports = { captureFrame, captureFrameBase64 };
