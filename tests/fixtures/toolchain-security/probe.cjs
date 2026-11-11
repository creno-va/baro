/* Synthetic dependency regression probe. No provider, credential, case or persisted private key. */
const {
  generateKeyPairSync,
  createHash,
  privateEncrypt,
  constants,
  webcrypto,
} = require("node:crypto");
const mode = process.argv[2];
function loadBrowserDistribution(path) {
  const browser = { crypto: webcrypto, setTimeout, clearTimeout };
  browser.self = browser;
  browser.window = browser;
  browser.navigator = { userAgent: "BARO synthetic browser probe" };
  // forge.all captures jQuery for deferred form/network helpers. They are
  // deliberately unavailable here; only crypto and in-memory protocol parsers run.
  browser.jQuery = new Proxy(
    () => {
      throw new Error("FORM_API_OUT_OF_SCOPE");
    },
    {
      get() {
        throw new Error("FORM_API_OUT_OF_SCOPE");
      },
    },
  );
  require("node:vm").runInNewContext(require("node:fs").readFileSync(path, "utf8"), browser, {
    timeout: 5000,
  });
  return browser.forge;
}
const dependency =
  mode === "forge-browser" || mode === "forge-browser-security"
    ? loadBrowserDistribution(process.argv[3])
    : require(process.argv[3]);
const outcome = (action) => {
  try {
    return action() === false ? "rejected" : "accepted";
  } catch (error) {
    if (error?.code === "ERR_BRACES_DEPTH") return "depth-rejected";
    if (error instanceof RangeError && /call stack/i.test(error.message)) return "stack-overflow";
    return "rejected";
  }
};
if (mode === "deepmerge") {
  const merge = dependency;
  const poisoned = (value) =>
    Object.getPrototypeOf(value) !== Object.prototype || value.syntheticPoison === true;
  const source = JSON.parse('{"__proto__":{"syntheticPoison":true}}');
  const target = Object.create(null);
  const malformed = {
    targetOwnProto: poisoned(merge(source, {})) ? "poisoned" : "safe",
    nullPrototypeTarget: poisoned(merge(target, source)) ? "poisoned" : "safe",
  };
  const left = { nested: { a: 1 }, list: [1] },
    right = { nested: { b: 2 }, list: [2] };
  const value = merge(left, right);
  const symbol = Symbol("synthetic");
  const symbolic = merge({ [symbol]: { a: 1 } }, { [symbol]: { b: 2 } });
  const compatibility = {
    nested: JSON.stringify(value),
    left: JSON.stringify(left),
    right: JSON.stringify(right),
    independentClone: value.nested !== left.nested && value.list !== left.list,
    symbols: JSON.stringify(symbolic[symbol]),
    custom: JSON.stringify(merge({ value: [1] }, { value: [2] }, { arrayMerge: (_a, b) => b })),
    globalPrototypeIntact: !Object.hasOwn(Object.prototype, "syntheticPoison"),
  };
  console.log(JSON.stringify({ mode, malformed, compatibility }));
} else if (mode === "braces") {
  const braces = dependency;
  const deep = "{".repeat(4000) + "x" + "}".repeat(4000);
  const parens = "(".repeat(4000) + "x" + ")".repeat(4000);
  const unbalanced = "{".repeat(4000) + "x";
  const deepAst = () => {
    const root = { type: "root", nodes: [] };
    let node = root;
    for (let i = 0; i < 2000; i++) {
      const child = {
        type: "brace",
        open: true,
        close: true,
        commas: 1,
        ranges: 0,
        nodes: [],
        parent: node,
      };
      node.nodes.push(child);
      node = child;
    }
    node.nodes.push({ type: "text", value: "x" });
    return root;
  };
  const attacks = {};
  for (const method of ["parse", "compile", "expand", "stringify"]) {
    attacks[`${method}:braces`] = outcome(() => braces[method](deep));
    attacks[`${method}:parentheses`] = outcome(() => braces[method](parens));
    attacks[`${method}:unbalanced`] = outcome(() => braces[method](unbalanced));
  }
  for (const method of ["compile", "expand", "stringify"])
    attacks[`${method}:ast`] = outcome(() => braces[method](deepAst()));
  const patterns = [
    "src/{pages,components}/**/*.{ts,tsx}",
    "a/{b,{c,d}}/e",
    "{01..04}",
    "file\\{name\\}",
    "{a,b}{1,2}",
    "x/(a|b)/{c,d}",
    "{".repeat(32) + "x" + "}".repeat(32),
  ];
  const compatibility = patterns.map((pattern) => ({
    pattern,
    compile: braces.compile(pattern),
    expand: braces.expand(pattern),
    stringify: braces.stringify(braces.parse(pattern)),
  }));
  const rangeLimitPreserved = outcome(() => braces.expand("{1..1000000}")) === "rejected";
  console.log(JSON.stringify({ mode, attacks, compatibility, rangeLimitPreserved }));
} else if (mode === "forge" || mode === "forge-browser") {
  const forge = dependency,
    asn1 = forge.asn1;
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 65537,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const privateKey = forge.pki.privateKeyFromPem(pair.privateKey);
  const publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
  const param = (value = "") => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, value);
  const garbage = () =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, "synthetic unconsumed bytes");
  const verify = (algorithm, parameters, suffix = "", mismatch = false) => {
    const digest = createHash(algorithm)
      .update("BARO synthetic DigestInfo regression")
      .digest("latin1");
    const identifier = [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OID,
        false,
        asn1.oidToDer(forge.pki.oids[algorithm]).getBytes(),
      ),
      ...parameters,
    ];
    const info = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, identifier),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest),
    ]);
    const encoded = asn1.toDer(info).getBytes() + suffix;
    // Normal padding and trailing-byte checks; this demonstrates a parser gap, not private-key-free forgery.
    // OpenSSL creates browser fixtures independently of forge's private RSA
    // implementation. The unmodified browser public verifier handles the input.
    const signature =
      mode === "forge-browser"
        ? privateEncrypt(
            { key: pair.privateKey, padding: constants.RSA_PKCS1_PADDING },
            Buffer.from(encoded, "latin1"),
          ).toString("latin1")
        : privateKey.sign(encoded, "NONE");
    return publicKey.verify(mismatch ? "wrong digest" : digest, signature);
  };
  const malformed = {
    extraChild: outcome(() => verify("sha256", [param(), garbage()])),
    garbageInsteadOfNull: outcome(() => verify("sha256", [garbage()])),
    repeatedNull: outcome(() => verify("sha256", [param(), param()])),
    nonemptyNull: outcome(() => verify("sha256", [param("synthetic hidden bytes")])),
    constructedNull: outcome(() =>
      verify("sha256", [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, true, [garbage()])]),
    ),
    trailingBytes: outcome(() => verify("sha256", [param()], "extra")),
    wrongDigest: outcome(() => verify("sha256", [param()], "", true)),
  };
  const compatibility = {};
  for (const algorithm of ["sha1", "sha224", "sha256", "sha384", "sha512", "md5"]) {
    compatibility[`${algorithm}:null`] = outcome(() => verify(algorithm, [param()]));
    compatibility[`${algorithm}:omitted`] = outcome(() => verify(algorithm, []));
  }
  const attributes = [{ name: "commonName", value: "synthetic.baro.invalid" }];
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = publicKey;
  certificate.serialNumber = "01";
  certificate.validity.notBefore = new Date();
  certificate.validity.notAfter = new Date(Date.now() + 3600000);
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.sign(privateKey, forge.md.sha256.create());
  compatibility.selfSignedCertificate = certificate.verify(certificate);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = publicKey;
  csr.setSubject(attributes);
  csr.sign(privateKey, forge.md.sha256.create());
  compatibility.certificateSigningRequest = csr.verify();
  console.log(JSON.stringify({ mode, malformed, compatibility }));
} else if (mode === "forge-security" || mode === "forge-browser-security") {
  const forge = dependency;
  const decode = (hex) => forge.util.binary.hex.decode(hex);
  const message = "BARO synthetic signature regression";
  const forged = decode("01" + "00".repeat(63));
  const security = {};
  for (const [name, key] of [
    ["identity", "01" + "00".repeat(31)],
    ["noncanonicalIdentity", "ee" + "ff".repeat(30) + "7f"],
  ]) {
    security[name] = forge.ed25519.verify({
      message,
      encoding: "utf8",
      signature: forged,
      publicKey: decode(key),
    })
      ? "accepted"
      : "rejected";
  }
  const pair = forge.ed25519.generateKeyPair({ seed: decode("07".repeat(32)) });
  const signature = forge.ed25519.sign({ message, encoding: "utf8", privateKey: pair.privateKey });
  security.validEdSignature = forge.ed25519.verify({
    message,
    encoding: "utf8",
    signature,
    publicKey: pair.publicKey,
  });
  security.changedMessageRejected = !forge.ed25519.verify({
    message: message + " changed",
    encoding: "utf8",
    signature,
    publicKey: pair.publicKey,
  });

  const version = forge.tls.Version;
  const suite = forge.tls.CipherSuites.TLS_RSA_WITH_AES_128_CBC_SHA;
  const record = (type, data) =>
    String.fromCharCode(type, version.major, version.minor, data.length >>> 8, data.length & 255) +
    data;
  const serverHello = (compression) => {
    const body =
      String.fromCharCode(version.major, version.minor) +
      "\0".repeat(32) +
      String.fromCharCode(0, ...suite.id, compression);
    return record(22, String.fromCharCode(2, 0, 0, body.length) + body);
  };
  const connection = () => {
    const alerts = [];
    const client = forge.tls.createConnection({
      server: false,
      caStore: [],
      cipherSuites: [suite],
      connected() {},
      tlsDataReady() {},
      dataReady() {},
      closed() {},
      error(_client, error) {
        alerts.push(error.alert?.description);
      },
    });
    return { client, alerts };
  };
  const malformed = connection();
  malformed.client.handshake();
  let threw = false;
  try {
    malformed.client.process(serverHello(127));
  } catch {
    threw = true;
  }
  security.unsupportedCompression = threw
    ? "threw"
    : malformed.alerts.includes(forge.tls.Alert.Description.illegal_parameter)
      ? "rejected"
      : "accepted";
  const normal = connection();
  normal.client.handshake();
  normal.client.process(serverHello(0));
  security.validServerHello = normal.alerts.length === 0 && normal.client.session !== null;
  for (const phase of ["beforeSession", "closedSession", "peerClosedSession"]) {
    const { client } = connection();
    if (phase !== "beforeSession") {
      client.handshake();
      if (phase === "closedSession") client.close();
      else client.process(record(21, String.fromCharCode(1, 0)));
    }
    if (client.session !== null) throw Error("SYNTHETIC_TLS_SESSION_NOT_CLOSED");
    try {
      client.process(serverHello(0));
      security[phase] = "safe";
    } catch {
      security[phase] = "threw";
    }
  }

  const http =
    mode === "forge-security"
      ? require(require("node:path").resolve(process.argv[3], "lib/http.js"))
      : forge.http;
  if (!http) security.http = "not-in-distribution";
  else {
    const value = "a" + " \t".repeat(160000) + "X";
    const response = http.createResponse();
    const input = forge.util.createBuffer(
      "HTTP/1.1 200 OK\r\nX-Baro-Regression: " +
        value +
        " \t\r\nSet-Cookie: fixture=" +
        value +
        " \t\r\n\r\n",
    );
    const start = performance.now();
    if (!response.readHeader(input)) throw Error("SYNTHETIC_HTTP_HEADER_INCOMPLETE");
    const cookies = response.getCookies();
    const elapsed = performance.now() - start;
    if (
      response.getField("X-Baro-Regression") !== value ||
      cookies.length !== 1 ||
      cookies[0].name !== "fixture" ||
      cookies[0].value !== value
    )
      throw Error("SYNTHETIC_HTTP_TRIM_RESULT_CHANGED");
    security.http = elapsed < 1000 ? "bounded" : "slow";
  }
  console.log(JSON.stringify({ mode, security }));
} else {
  throw new Error("SYNTHETIC_PROBE_MODE_INVALID");
}
