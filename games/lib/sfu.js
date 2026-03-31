'use strict';

/**
 * Mediasoup SFU — Single upload from broadcaster, server fans out to viewers.
 * One Worker, one Router per broadcast room, Transports per participant.
 */

const mediasoup = require('mediasoup');

// Media codecs the SFU will support
const MEDIA_CODECS = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000,
    },
  },
];

// WebRTC transport settings
const LISTEN_IP = process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0';
const ANNOUNCED_IP = process.env.TURN_SERVER || '104.237.138.28';

let worker = null;
const rooms = new Map(); // code → { router, broadcaster, consumers }

async function init() {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: 40000,
    rtcMaxPort: 40999,
  });

  worker.on('died', () => {
    console.error('[sfu] Worker died, restarting...');
    setTimeout(() => init(), 2000);
  });

  console.log('[sfu] Mediasoup worker started (pid: ' + worker.pid + ')');
}

async function createRoom(code) {
  if (rooms.has(code)) return rooms.get(code);

  const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
  const room = {
    router,
    broadcaster: null, // { transport, producers: [audioProducer, videoProducer] }
    consumers: new Map(), // socketId → { transport, consumers: [] }
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code) || null;
}

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  room.router.close();
  rooms.delete(code);
}

// Get router RTP capabilities (client needs these to create device)
function getRouterCapabilities(code) {
  const room = rooms.get(code);
  if (!room) return null;
  return room.router.rtpCapabilities;
}

// Create a WebRTC transport (for broadcaster or viewer)
async function createTransport(code) {
  const room = rooms.get(code);
  if (!room) throw new Error('Room not found');

  const transport = await room.router.createWebRtcTransport({
    listenInfos: [
      { protocol: 'udp', ip: LISTEN_IP, announcedAddress: ANNOUNCED_IP },
      { protocol: 'tcp', ip: LISTEN_IP, announcedAddress: ANNOUNCED_IP },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1000000,
  });

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    _transport: transport, // keep ref for server-side use
  };
}

// Connect transport (complete DTLS handshake)
async function connectTransport(code, transportId, dtlsParameters, role) {
  const room = rooms.get(code);
  if (!room) throw new Error('Room not found');

  let transport;
  if (role === 'broadcaster' && room.broadcaster) {
    transport = room.broadcaster.transport;
  } else {
    const consumer = room.consumers.get(transportId);
    if (consumer) transport = consumer.transport;
  }

  // Search all transports
  if (!transport) {
    if (room.broadcaster && room.broadcaster.transport.id === transportId) {
      transport = room.broadcaster.transport;
    }
    for (const [, c] of room.consumers) {
      if (c.transport.id === transportId) { transport = c.transport; break; }
    }
  }

  if (!transport) throw new Error('Transport not found');
  await transport.connect({ dtlsParameters });
}

// Broadcaster produces media (sends stream to SFU)
async function produce(code, transportId, kind, rtpParameters) {
  const room = rooms.get(code);
  if (!room || !room.broadcaster) throw new Error('No broadcaster transport');

  const producer = await room.broadcaster.transport.produce({ kind, rtpParameters });
  room.broadcaster.producers.push(producer);

  producer.on('transportclose', () => {
    producer.close();
  });

  return { id: producer.id };
}

// Viewer consumes media (receives stream from SFU)
async function consume(code, socketId, rtpCapabilities) {
  const room = rooms.get(code);
  if (!room || !room.broadcaster) return [];

  const consumerData = room.consumers.get(socketId);
  if (!consumerData) return [];

  const results = [];

  for (const producer of room.broadcaster.producers) {
    if (!room.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
      continue;
    }

    const consumer = await consumerData.transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true, // start paused, client resumes
    });

    consumer.on('transportclose', () => consumer.close());
    consumer.on('producerclose', () => consumer.close());

    consumerData.consumers.push(consumer);

    results.push({
      id: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  }

  return results;
}

// Resume a consumer (client calls this after setting up the track)
async function resumeConsumer(code, socketId, consumerId) {
  const room = rooms.get(code);
  if (!room) return;
  const consumerData = room.consumers.get(socketId);
  if (!consumerData) return;
  const consumer = consumerData.consumers.find(c => c.id === consumerId);
  if (consumer) await consumer.resume();
}

// Setup broadcaster transport
async function setupBroadcaster(code) {
  const room = rooms.get(code);
  if (!room) throw new Error('Room not found');

  const tData = await createTransport(code);
  room.broadcaster = {
    transport: tData._transport,
    producers: [],
  };

  return {
    id: tData.id,
    iceParameters: tData.iceParameters,
    iceCandidates: tData.iceCandidates,
    dtlsParameters: tData.dtlsParameters,
  };
}

// Setup viewer transport
async function setupViewer(code, socketId) {
  const room = rooms.get(code);
  if (!room) throw new Error('Room not found');

  const tData = await createTransport(code);
  room.consumers.set(socketId, {
    transport: tData._transport,
    consumers: [],
  });

  return {
    id: tData.id,
    iceParameters: tData.iceParameters,
    iceCandidates: tData.iceCandidates,
    dtlsParameters: tData.dtlsParameters,
  };
}

// Remove viewer
function removeViewer(code, socketId) {
  const room = rooms.get(code);
  if (!room) return;
  const consumerData = room.consumers.get(socketId);
  if (consumerData) {
    consumerData.consumers.forEach(c => c.close());
    consumerData.transport.close();
    room.consumers.delete(socketId);
  }
}

module.exports = {
  init,
  createRoom,
  getRoom,
  closeRoom,
  getRouterCapabilities,
  setupBroadcaster,
  setupViewer,
  connectTransport,
  produce,
  consume,
  resumeConsumer,
  removeViewer,
};
