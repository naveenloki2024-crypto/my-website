const path = require('path');

// Load .env from the project root regardless of the current working directory.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

const MONGODB_URI = (process.env.MONGODB_URI || '').trim();

// TLS stays enabled: MongoDB Atlas rejects unencrypted connections, and
// mongodb+srv:// URIs require TLS by default. `tls: true` makes that explicit.
const CONNECTION_OPTIONS = {
  serverSelectionTimeoutMS: 5000,
  tls: true,
  retryWrites: true,
  w: 'majority',
  appName: 'rare-habit'
};

function connectedStateText(state) {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][state] || 'unknown';
}

// Strip any user:password credentials from a URI before it can reach a log.
function redactMongoUri(uri) {
  if (!uri) return '(not configured)';
  return String(uri).replace(/\/\/([^/@:]+)(:([^@/]*))?@/, '//***:***@');
}

// Sanitize a driver error message: driver errors can embed the full connection
// string (including username/password). Never print raw credentials.
function safeErrorText(error) {
  if (!error) return 'unknown error';
  let text = String(error && error.message || error);
  text = text.replace(/mongodb(\+srv)?:\/\/[^@/\s]+@/gi, 'mongodb$1://***:***@');
  text = text.replace(/(password|passcode)\s*=\s*[^&\s]+/gi, '$1=***');
  return text;
}

function validateMongoUri(uri) {
  if (!uri || uri.startsWith('your_mongodb_uri_here')) {
    return new Error(
      'MONGODB_URI is not configured to a real MongoDB connection string. ' +
      'Add your MongoDB URI to the .env file (e.g. MONGODB_URI=mongodb+srv://...).'
    );
  }

  // The scheme is mandatory. A common pasting mistake is dropping it, which
  // leaves a string like "//user:password@host..." and produces TLS/parse
  // errors instead of a clean failure.
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    return new Error(
      'MONGODB_URI must start with "mongodb+srv://" or "mongodb://". ' +
      'The configured value is missing the scheme (looks like "' +
      redactMongoUri(uri) + '"). Fix MONGODB_URI in the .env file.'
    );
  }

  try {
    const parsed = new URL(uri);
    if (!parsed.hostname) {
      return new Error('MONGODB_URI is missing a host. Fix MONGODB_URI in the .env file.');
    }

    // Special characters in a MongoDB password must be URL-encoded or the URI
    // is mis-parsed. Only warn here so the connection can still attempt retries.
    const rawPassword = parsed.password;
    if (rawPassword && /[^A-Za-z0-9._~!$()*+,;=:@%]/.test(decodeURIComponent(rawPassword))) {
      console.warn(
        '[MongoDB] Warning: the password in MONGODB_URI contains characters that should be ' +
        'URL-encoded (@ -> %40, : -> %3A, / -> %2F, # -> %23, ? -> %3F). ' +
        'Re-encode it in the .env file if authentication keeps failing.'
      );
    }
  } catch (error) {
    return new Error('MONGODB_URI is not a valid URI: ' + safeErrorText(error));
  }

  return null;
}

async function connectDB() {
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    return mongoose.connection;
  }

  const uriError = validateMongoUri(MONGODB_URI);
  if (uriError) {
    uriError.code = 'NO_MONGODB_URI';
    throw uriError;
  }

  try {
    await mongoose.connect(MONGODB_URI, CONNECTION_OPTIONS);
    console.log(
      `[MongoDB] Connected to ${mongoose.connection.host} ` +
      `(database: ${mongoose.connection.name || 'default'}).`
    );
  } catch (error) {
    console.error(`[MongoDB] Connection failed: ${safeErrorText(error)}`);
    throw error;
  }

  return mongoose.connection;
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

function isConnected() {
  return mongoose.connection.readyState === 1;
}

mongoose.connection.on('connecting', () => {
  console.log('[MongoDB] Connecting...');
});

mongoose.connection.on('connected', () => {
  console.log('[MongoDB] Connected.');
});

mongoose.connection.on('reconnected', () => {
  console.log('[MongoDB] Reconnected.');
});

mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Disconnected.');
});

mongoose.connection.on('error', (err) => {
  console.error(`[MongoDB] connection error: ${safeErrorText(err)}`);
});

module.exports = {
  mongoose,
  connectDB,
  disconnectDB,
  isConnected,
  connectedStateText,
  MONGODB_URI,
  redactMongoUri,
  safeErrorText
};