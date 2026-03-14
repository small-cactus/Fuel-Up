const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http2 = require('http2');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { createClient } = require('@supabase/supabase-js');

const appConfig = require('../app.json');

function getAppExtra() {
    return appConfig?.expo?.extra || {};
}

function getDefaultTopic() {
    return appConfig?.expo?.ios?.bundleIdentifier || '';
}

function getDefaultApnsEnvironment() {
    const apsEnvironment = appConfig?.expo?.ios?.entitlements?.['aps-environment'];
    return apsEnvironment === 'production' ? 'production' : 'sandbox';
}

function pickFirstNonEmpty(...values) {
    for (const value of values) {
        const normalizedValue = String(value || '').trim();
        if (normalizedValue) {
            return normalizedValue;
        }
    }

    return '';
}

function parseArgs(argv) {
    const parsedArgs = {
        body: '',
        help: false,
        json: false,
        list: false,
        title: '',
        token: '',
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const nextArg = argv[index + 1];

        if (arg === '--help' || arg === '-h') {
            parsedArgs.help = true;
            continue;
        }

        if (arg === '--list') {
            parsedArgs.list = true;
            continue;
        }

        if (arg === '--json') {
            parsedArgs.json = true;
            continue;
        }

        if (arg === '--sandbox') {
            parsedArgs.environment = 'sandbox';
            continue;
        }

        if (arg === '--production') {
            parsedArgs.environment = 'production';
            continue;
        }

        if (arg.startsWith('--token=')) {
            parsedArgs.token = arg.slice('--token='.length);
            continue;
        }

        if (arg === '--token' && nextArg) {
            parsedArgs.token = nextArg;
            index += 1;
            continue;
        }

        if (arg.startsWith('--title=')) {
            parsedArgs.title = arg.slice('--title='.length);
            continue;
        }

        if (arg === '--title' && nextArg) {
            parsedArgs.title = nextArg;
            index += 1;
            continue;
        }

        if (arg.startsWith('--body=')) {
            parsedArgs.body = arg.slice('--body='.length);
            continue;
        }

        if (arg === '--body' && nextArg) {
            parsedArgs.body = nextArg;
            index += 1;
            continue;
        }
    }

    return parsedArgs;
}

function printHelp() {
    console.log(`
Usage:
  node ./scripts/sendPushNotification.cjs
  node ./scripts/sendPushNotification.cjs --list
  node ./scripts/sendPushNotification.cjs --token <raw-apns-token> --title "Fuel Up" --body "Price drop"

Credential options:
  APNS_AUTH_KEY_PATH   Path to an APNs .p8 auth key
  APNS_KEY_ID          APNs auth key ID
  APNS_TEAM_ID         Apple Developer team ID

  or

  APNS_CERT_PATH       Path to an APNs certificate (.pem/.cer converted to pem)
  APNS_KEY_PATH        Path to the matching private key
  APNS_KEY_PASSPHRASE  Optional private key passphrase

Optional env vars:
  APNS_ENV             sandbox | production
  APNS_TOPIC           Defaults to app bundle id
  SUPABASE_URL         Defaults to app.json extra.supabase.url
  SUPABASE_KEY         Defaults to app.json extra.supabase.key
`);
}

function shortToken(token) {
    const normalizedToken = String(token || '').trim();
    if (normalizedToken.length <= 18) {
        return normalizedToken;
    }

    return `${normalizedToken.slice(0, 10)}...${normalizedToken.slice(-8)}`;
}

function formatTokenRow(row, index) {
    const createdAt = row.created_at ? new Date(row.created_at).toLocaleString() : 'unknown';
    return `${String(index + 1).padStart(2, ' ')}. ${shortToken(row.token)}  ${createdAt}`;
}

 function getSupabaseConfig() {
     const extra = getAppExtra();
     const extraSupabase = extra.supabase || {};
    const url = pickFirstNonEmpty(
        process.env.SUPABASE_URL,
        process.env.EXPO_PUBLIC_SUPABASE_URL,
        extraSupabase.url,
        extra.EXPO_PUBLIC_SUPABASE_URL
    );
     const key = pickFirstNonEmpty(
         process.env.SUPABASE_KEY,
        process.env.EXPO_PUBLIC_SUPABASE_KEY,
         extraSupabase.key,
         extra.EXPO_PUBLIC_SUPABASE_KEY
     );

    return { url, key };
}

function getApnsConfig(overrides = {}) {
     const authKeyPath = pickFirstNonEmpty(process.env.APNS_AUTH_KEY_PATH);
     const authKeyIdFromPath = path.basename(authKeyPath).match(/AuthKey_([A-Z0-9]+)\.p8$/)?.[1] || '';
     const certPath = pickFirstNonEmpty(process.env.APNS_CERT_PATH);
     const keyPath = pickFirstNonEmpty(process.env.APNS_KEY_PATH);

     return {
         authKeyId: pickFirstNonEmpty(process.env.APNS_KEY_ID, authKeyIdFromPath),
         authKeyPath,
         certPath,
        environment: pickFirstNonEmpty(overrides.environment, process.env.APNS_ENV, getDefaultApnsEnvironment()),
         keyPassphrase: pickFirstNonEmpty(process.env.APNS_KEY_PASSPHRASE),
         keyPath,
         teamId: pickFirstNonEmpty(process.env.APNS_TEAM_ID),
         topic: pickFirstNonEmpty(process.env.APNS_TOPIC, getDefaultTopic()),
     };
}

function ensureReadableFile(filePath, label) {
    if (!filePath) {
        throw new Error(`${label} is required.`);
    }

    fs.accessSync(filePath, fs.constants.R_OK);
}

function base64url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch (error) {
        return {
            raw: text,
        };
    }
}

function buildProviderToken(teamId, keyId, privateKeyPem) {
    const header = { alg: 'ES256', kid: keyId };
    const claims = { iss: teamId, iat: Math.floor(Date.now() / 1000) };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signer = crypto.createSign('sha256');
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(privateKeyPem);

    return `${signingInput}.${base64url(signature)}`;
}

function createHttp2Client(apnsConfig) {
    const apnsHost = apnsConfig.environment === 'production'
        ? 'https://api.push.apple.com'
        : 'https://api.sandbox.push.apple.com';

    if (apnsConfig.authKeyPath) {
        ensureReadableFile(apnsConfig.authKeyPath, 'APNS_AUTH_KEY_PATH');
        if (!apnsConfig.authKeyId) {
            throw new Error('APNS_KEY_ID is required when using APNS_AUTH_KEY_PATH.');
        }
        if (!apnsConfig.teamId) {
            throw new Error('APNS_TEAM_ID is required when using APNS_AUTH_KEY_PATH.');
        }

        const providerToken = buildProviderToken(
            apnsConfig.teamId,
            apnsConfig.authKeyId,
            fs.readFileSync(apnsConfig.authKeyPath, 'utf8')
        );

        return {
            client: http2.connect(apnsHost),
            headers: {
                authorization: `bearer ${providerToken}`,
            },
            mode: 'auth-key',
        };
    }

    ensureReadableFile(apnsConfig.certPath, 'APNS_CERT_PATH');
    ensureReadableFile(apnsConfig.keyPath, 'APNS_KEY_PATH');

    return {
        client: http2.connect(apnsHost, {
            cert: fs.readFileSync(apnsConfig.certPath),
            key: fs.readFileSync(apnsConfig.keyPath),
            passphrase: apnsConfig.keyPassphrase || undefined,
        }),
        headers: {},
        mode: 'certificate',
    };
}

async function fetchPushTokens() {
    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
        throw new Error('Supabase credentials are missing. Set SUPABASE_URL/SUPABASE_KEY or use app.json extra.supabase.');
    }

    const supabase = createClient(url, key);
    const tokens = [];
    const pageSize = 1000;

    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
            .from('push_tokens')
            .select('id, token, created_at')
            .order('created_at', { ascending: false })
            .range(from, from + pageSize - 1);

        if (error) {
            throw new Error(`Failed to fetch push tokens: ${error.message}`);
        }

        tokens.push(...(data || []));

        if (!data || data.length < pageSize) {
            break;
        }
    }

    return tokens;
}

async function promptForSelection(tokens) {
    if (!stdin.isTTY || !stdout.isTTY) {
        throw new Error('Interactive selection requires a TTY. Pass --token to skip the prompt.');
    }

    const rl = readline.createInterface({ input: stdin, output: stdout });

    try {
        console.log('\nPush tokens:\n');
        tokens.forEach((row, index) => {
            console.log(formatTokenRow(row, index));
        });

        const answer = await rl.question('\nSelect a token by number: ');
        const selectedIndex = Number.parseInt(answer, 10) - 1;

        if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= tokens.length) {
            throw new Error('Invalid token selection.');
        }

        return tokens[selectedIndex].token;
    } finally {
        rl.close();
    }
}

async function promptForText(defaultTitle, defaultBody) {
    if (!stdin.isTTY || !stdout.isTTY) {
        return {
            body: defaultBody,
            title: defaultTitle,
        };
    }

    const rl = readline.createInterface({ input: stdin, output: stdout });

    try {
        const titleInput = await rl.question(`Notification title [${defaultTitle}]: `);
        const bodyInput = await rl.question(`Notification body [${defaultBody}]: `);

        return {
            body: bodyInput.trim() || defaultBody,
            title: titleInput.trim() || defaultTitle,
        };
    } finally {
        rl.close();
    }
}

async function sendPushNotification({ token, title, body, apnsConfig }) {
    if (!token) {
        throw new Error('A raw APNs device token is required.');
    }

    if (!apnsConfig.topic) {
        throw new Error('APNS_TOPIC is required or app.json must include expo.ios.bundleIdentifier.');
    }

    const { client, headers: authHeaders, mode } = createHttp2Client(apnsConfig);

    return await new Promise((resolve, reject) => {
        let settled = false;
        let responseBody = '';
        let responseHeaders = null;

        const finish = (callback, value) => {
            if (settled) {
                return;
            }

            settled = true;
            try {
                client.close();
            } catch (error) {
                // ignore client close errors after settlement
            }
            callback(value);
        };

        client.on('error', (error) => {
            finish(reject, error);
        });

        const request = client.request({
            ':method': 'POST',
            ':path': `/3/device/${token}`,
            'apns-priority': '10',
            'apns-push-type': 'alert',
            'apns-topic': apnsConfig.topic,
            ...authHeaders,
        });

        request.setEncoding('utf8');
        request.on('response', (incomingHeaders) => {
            responseHeaders = incomingHeaders;
        });
        request.on('data', (chunk) => {
            responseBody += chunk;
        });
        request.on('end', () => {
            const status = responseHeaders?.[':status'] || 0;
            const parsedBody = responseBody ? safeJsonParse(responseBody) : null;

            finish(resolve, {
                body: parsedBody,
                credentialMode: mode,
                environment: apnsConfig.environment,
                ok: status === 200,
                status,
                token,
                topic: apnsConfig.topic,
            });
        });
        request.on('error', (error) => {
            finish(reject, error);
        });

        request.end(JSON.stringify({
            aps: {
                alert: {
                    title,
                    body,
                },
                sound: 'default',
            },
        }));
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    const tokens = await fetchPushTokens();
    if (args.list) {
        if (!tokens.length) {
            console.log('No push tokens found.');
            return;
        }

        tokens.forEach((row, index) => {
            console.log(formatTokenRow(row, index));
        });
        return;
    }

    if (!tokens.length && !args.token) {
        throw new Error('No push tokens found in Supabase.');
    }

    const token = args.token || await promptForSelection(tokens);
    const { title, body } = await promptForText(
        args.title || 'Fuel Up',
        args.body || 'Fuel prices just dropped nearby.'
    );

    const result = await sendPushNotification({
        apnsConfig: getApnsConfig({ environment: args.environment }),
        body,
        title,
        token,
    });

    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (result.ok) {
        console.log(`Sent push notification to ${shortToken(token)} via ${result.credentialMode} (${result.environment}).`);
        return;
    }

    const reason = result.body?.reason ? `: ${result.body.reason}` : '';
    throw new Error(`APNs rejected the notification with status ${result.status}${reason}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
