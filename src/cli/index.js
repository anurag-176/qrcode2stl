#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { PNG } from 'pngjs';
import qrcode from 'qrcode';
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import * as pathThatSvgModule from 'path-that-svg';
import QRCode3D from '../qrcode3d.js';
import BaseTag3D from '../base.js';
import SpotifyCode3D from '../spotifyCode3D.js';
import { trimIconShapesBounds } from '../utils.js';
import { qrDefaultOptions, spotifyDefaultOptions, textDefaultOptions } from './defaultOptions.js';
import { getQRText } from './qrText.js';

globalThis.DOMParser = globalThis.DOMParser || DOMParser;
const pathThatSvg = pathThatSvgModule.pathThatSvg
  || pathThatSvgModule.default?.pathThatSvg
  || pathThatSvgModule.default?.default
  || pathThatSvgModule.default;

const CONTENT_TYPES = {
  text: 0,
  wifi: 1,
  email: 2,
  contact: 3,
  sms: 4,
  calendar: 5,
};

const findProjectRoot = async () => {
  const starts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let current = start;
    for (let i = 0; i < 5; i += 1) {
      try {
        await fs.access(path.join(current, 'public', 'icons'));
        return current;
      } catch (error) {
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }
  }
  return process.cwd();
};

const help = `qrcode2stl-cli

Usage:
  qrcode2stl --mode qr --content-type text --text "https://example.com" --output-dir ./out
  qrcode2stl --mode qr --content-type wifi --wifi-ssid MyWifi --wifi-password secret --output-dir ./out
  qrcode2stl --mode text --base-text-message "Desk Label" --output-dir ./out
  qrcode2stl --mode spotify --spotify-uri "spotify:track:..." --output-dir ./out

Required:
  --output-dir <dir>                  Directory where STL files will be written

General:
  --mode <qr|text|spotify>            Generation mode (default: qr)
  --filename <name>                   Base output filename (default: generated timestamp)
  --format <binary|ascii>             STL format (default: binary)
  --separate-parts                    Write base/code/border/icon/text parts as separate STL files
  --options-json <file>               Merge additional options JSON into the selected mode defaults

QR content:
  --content-type <text|wifi|email|contact|sms|calendar>
  --text <value>
  --use-escape-sequences
  --wifi-ssid <value> --wifi-password <value> --wifi-security <WPA|WEP|nopass> --wifi-hidden
  --email-recipient <value> --email-subject <value> --email-body <value>
  --contact-first-name <value> --contact-last-name <value> --contact-email <value>
  --contact-organization <value> --contact-role <value> --contact-cell <value> --contact-phone <value>
  --contact-fax <value> --contact-street <value> --contact-postcode <value> --contact-city <value>
  --contact-state <value> --contact-country <value> --contact-website <value>
  --sms-recipient <value> --sms-message <value>
  --calendar-event-name <value> --calendar-start-date YYYY-MM-DD --calendar-start-time HH:mm
  --calendar-end-date YYYY-MM-DD --calendar-end-time HH:mm --calendar-all-day
  --calendar-location <value> --calendar-description <value>
  --error-correction <L|M|Q|H>        QR error correction level (default: M, icon defaults to H unless set)

Model options:
  --base-shape <rectangle|roundedRectangle>
  --base-width <mm> --base-height <mm> --base-depth <mm> --base-corner-radius <mm>
  --base-border / --no-base-border --base-border-width <mm> --base-border-depth <mm>
  --base-text / --no-base-text --base-text-message <value>
  --base-text-placement <top|bottom|left|right|center> --base-text-size <mm>
  --base-text-margin <mm> --base-text-depth <mm> --base-text-align <left|center|right>
  --keychain / --no-keychain --keychain-placement <left|right|top|bottom>
  --keychain-hole-diameter <mm> --keychain-material-thickness <mm> --keychain-offset <mm> --mirror-holes
  --nfc / --no-nfc --nfc-shape <square|round> --nfc-size <mm> --nfc-depth <mm> --nfc-hidden
  --magnet-pockets / --no-magnet-pockets --magnet-pocket-size <mm>
  --magnet-pocket-depth <mm> --magnet-pocket-offset <mm>
  --code-depth <mm> --code-margin <mm> --code-invert --code-city-mode --code-depth-max <mm>
  --block-size <percent> --block-corner-radius <mm>
  --icon <name|none>                  Built-in icon from public/icons without .svg
  --icon-svg <file>                   Custom SVG icon file
  --icon-size <percent> --icon-margin <modules> --compatibility-mode

Spotify:
  --spotify-uri <spotify-uri-or-url>
  --spotify-svg <file>                Use a local Spotify code SVG instead of downloading one

Other:
  --help`;

const clone = (value) => JSON.parse(JSON.stringify(value));

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) throw new Error(`Unexpected positional argument: ${raw}`);
    const eqIndex = raw.indexOf('=');
    const key = raw.slice(2, eqIndex === -1 ? undefined : eqIndex);
    if (key === 'help') {
      args.help = true;
      continue;
    }
    if (eqIndex !== -1) {
      args[key] = raw.slice(eqIndex + 1);
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
};

const setDeep = (target, pathParts, value) => {
  let cursor = target;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    cursor[pathParts[i]] = cursor[pathParts[i]] || {};
    cursor = cursor[pathParts[i]];
  }
  cursor[pathParts[pathParts.length - 1]] = value;
};

const mergeDeep = (target, source) => {
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = mergeDeep(target[key] || {}, value);
    } else {
      target[key] = value;
    }
  });
  return target;
};

const has = (args, key) => Object.prototype.hasOwnProperty.call(args, key);
const str = (args, key) => (has(args, key) ? String(args[key]) : undefined);
const bool = (args, key) => has(args, key) && args[key] !== false && args[key] !== 'false';
const number = (args, key) => {
  if (!has(args, key)) return undefined;
  const value = Number(args[key]);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number`);
  return value;
};

const applyString = (args, options, key, pathParts) => {
  if (has(args, key)) setDeep(options, pathParts, String(args[key]));
};

const applyNumber = (args, options, key, pathParts, min = 0) => {
  const value = number(args, key);
  if (value === undefined) return;
  if (value < min) throw new Error(`--${key} must be at least ${min}`);
  setDeep(options, pathParts, value);
};

const applyBool = (args, options, key, pathParts, value = true) => {
  if (has(args, key)) setDeep(options, pathParts, value);
};

const validateEnum = (value, allowed, name) => {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  }
};

const validateDate = (value, name) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00`).getTime())) {
    throw new Error(`${name} must be a date in YYYY-MM-DD format`);
  }
};

const validateTime = (value, name) => {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error(`${name} must be a time in HH:mm format`);
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) throw new Error(`${name} must be a valid time in HH:mm format`);
};

const applyBaseOptions = (args, options) => {
  applyString(args, options, 'base-shape', ['base', 'shape']);
  applyNumber(args, options, 'base-width', ['base', 'width'], 1);
  applyNumber(args, options, 'base-height', ['base', 'height'], 1);
  applyNumber(args, options, 'base-depth', ['base', 'depth'], 0.01);
  applyNumber(args, options, 'base-corner-radius', ['base', 'cornerRadius']);
  applyBool(args, options, 'base-border', ['base', 'hasBorder'], true);
  applyBool(args, options, 'no-base-border', ['base', 'hasBorder'], false);
  applyNumber(args, options, 'base-border-width', ['base', 'borderWidth']);
  applyNumber(args, options, 'base-border-depth', ['base', 'borderDepth']);
  applyBool(args, options, 'base-text', ['base', 'hasText'], true);
  applyBool(args, options, 'no-base-text', ['base', 'hasText'], false);
  applyString(args, options, 'base-text-message', ['base', 'textMessage']);
  applyString(args, options, 'base-text-placement', ['base', 'textPlacement']);
  applyNumber(args, options, 'base-text-size', ['base', 'textSize'], 0.01);
  applyNumber(args, options, 'base-text-margin', ['base', 'textMargin']);
  applyNumber(args, options, 'base-text-depth', ['base', 'textDepth']);
  applyString(args, options, 'base-text-align', ['base', 'textAlign']);
  applyBool(args, options, 'keychain', ['base', 'hasKeychainAttachment'], true);
  applyBool(args, options, 'no-keychain', ['base', 'hasKeychainAttachment'], false);
  applyString(args, options, 'keychain-placement', ['base', 'keychainPlacement']);
  applyNumber(args, options, 'keychain-hole-diameter', ['base', 'keychainHoleDiameter']);
  applyNumber(args, options, 'keychain-material-thickness', ['base', 'keychainMaterialThickness']);
  applyNumber(args, options, 'keychain-offset', ['base', 'keychainOffset']);
  applyBool(args, options, 'mirror-holes', ['base', 'mirrorHoles'], true);
  applyBool(args, options, 'nfc', ['base', 'hasNfcIndentation'], true);
  applyBool(args, options, 'no-nfc', ['base', 'hasNfcIndentation'], false);
  applyString(args, options, 'nfc-shape', ['base', 'nfcIndentationShape']);
  applyNumber(args, options, 'nfc-size', ['base', 'nfcIndentationSize']);
  applyNumber(args, options, 'nfc-depth', ['base', 'nfcIndentationDepth']);
  applyBool(args, options, 'nfc-hidden', ['base', 'nfcIndentationHidden'], true);
  applyBool(args, options, 'magnet-pockets', ['base', 'hasMagnetPockets'], true);
  applyBool(args, options, 'no-magnet-pockets', ['base', 'hasMagnetPockets'], false);
  applyNumber(args, options, 'magnet-pocket-size', ['base', 'magnetPocketSize']);
  applyNumber(args, options, 'magnet-pocket-depth', ['base', 'magnetPocketDepth']);
  applyNumber(args, options, 'magnet-pocket-offset', ['base', 'magnetPocketOffset']);

  if (!has(args, 'base-height') && has(args, 'base-width')) options.base.height = options.base.width;
};

const applyCodeOptions = (args, options) => {
  applyNumber(args, options, 'code-depth', ['code', 'depth'], 0.01);
  applyNumber(args, options, 'code-margin', ['code', 'margin']);
  applyBool(args, options, 'code-invert', ['code', 'invert'], true);
  applyBool(args, options, 'code-city-mode', ['code', 'cityMode'], true);
  applyNumber(args, options, 'code-depth-max', ['code', 'depthMax'], 0.01);
  applyNumber(args, options, 'block-size', ['code', 'blockSizeMultiplier'], 1);
  applyNumber(args, options, 'block-corner-radius', ['code', 'blockCornerRadius']);
  applyString(args, options, 'icon', ['code', 'iconName']);
  applyNumber(args, options, 'icon-size', ['code', 'iconSizeRatio'], 1);
  applyNumber(args, options, 'icon-margin', ['code', 'iconBlockMargin']);
  applyBool(args, options, 'compatibility-mode', ['code', 'compatibilityMode'], true);
};

const validateModelOptions = (options, mode) => {
  validateEnum(options.base.shape, ['rectangle', 'roundedRectangle'], '--base-shape');
  validateEnum(options.base.textPlacement, ['top', 'bottom', 'left', 'right', 'center'], '--base-text-placement');
  validateEnum(options.base.textAlign, ['left', 'center', 'right'], '--base-text-align');
  validateEnum(options.base.keychainPlacement, ['left', 'right', 'top', 'bottom'], '--keychain-placement');
  validateEnum(options.base.nfcIndentationShape, ['square', 'round'], '--nfc-shape');
  if (mode === 'qr') {
    validateEnum(options.errorCorrectionLevel, ['L', 'M', 'Q', 'H'], '--error-correction');
  }
  if (options.base.hasBorder && options.base.borderWidth * 2 >= Math.min(options.base.width, options.base.height)) {
    throw new Error('base border width is too large for the selected base dimensions');
  }
  if (options.code?.cityMode && options.code.depthMax < options.code.depth) {
    throw new Error('--code-depth-max must be greater than or equal to --code-depth when city mode is enabled');
  }
};

const buildQROptions = async (args) => {
  const options = clone(qrDefaultOptions);
  if (has(args, 'options-json')) mergeDeep(options, JSON.parse(await fs.readFile(args['options-json'], 'utf8')));

  const contentType = str(args, 'content-type') || 'text';
  validateEnum(contentType, Object.keys(CONTENT_TYPES), '--content-type');
  options.activeTabIndex = CONTENT_TYPES[contentType];

  applyString(args, options, 'text', ['text']);
  applyBool(args, options, 'use-escape-sequences', ['useEscapeSequences'], true);
  applyString(args, options, 'wifi-ssid', ['wifi', 'ssid']);
  applyString(args, options, 'wifi-password', ['wifi', 'password']);
  applyString(args, options, 'wifi-security', ['wifi', 'security']);
  applyBool(args, options, 'wifi-hidden', ['wifi', 'hidden'], true);
  applyString(args, options, 'email-recipient', ['email', 'recipient']);
  applyString(args, options, 'email-subject', ['email', 'subject']);
  applyString(args, options, 'email-body', ['email', 'body']);
  applyString(args, options, 'contact-first-name', ['contact', 'firstName']);
  applyString(args, options, 'contact-last-name', ['contact', 'lastName']);
  applyString(args, options, 'contact-organization', ['contact', 'organization']);
  applyString(args, options, 'contact-role', ['contact', 'role']);
  applyString(args, options, 'contact-cell', ['contact', 'cell']);
  applyString(args, options, 'contact-phone', ['contact', 'phone']);
  applyString(args, options, 'contact-fax', ['contact', 'fax']);
  applyString(args, options, 'contact-email', ['contact', 'email']);
  applyString(args, options, 'contact-street', ['contact', 'street']);
  applyString(args, options, 'contact-postcode', ['contact', 'postcode']);
  applyString(args, options, 'contact-city', ['contact', 'city']);
  applyString(args, options, 'contact-state', ['contact', 'state']);
  applyString(args, options, 'contact-country', ['contact', 'country']);
  applyString(args, options, 'contact-website', ['contact', 'website']);
  applyString(args, options, 'sms-recipient', ['sms', 'recipient']);
  applyString(args, options, 'sms-message', ['sms', 'message']);
  applyString(args, options, 'calendar-event-name', ['calendar', 'eventName']);
  applyString(args, options, 'calendar-start-date', ['calendar', 'startDate']);
  applyString(args, options, 'calendar-start-time', ['calendar', 'startTime']);
  applyString(args, options, 'calendar-end-date', ['calendar', 'endDate']);
  applyString(args, options, 'calendar-end-time', ['calendar', 'endTime']);
  applyBool(args, options, 'calendar-all-day', ['calendar', 'allDay'], true);
  applyString(args, options, 'calendar-location', ['calendar', 'location']);
  applyString(args, options, 'calendar-description', ['calendar', 'description']);
  applyString(args, options, 'error-correction', ['errorCorrectionLevel']);
  applyBaseOptions(args, options);
  applyCodeOptions(args, options);

  validateEnum(options.wifi.security, ['WPA', 'WEP', 'nopass'], '--wifi-security');
  if (contentType === 'text' && !options.text) throw new Error('--text is required when --content-type text');
  if (contentType === 'wifi' && !options.wifi.ssid) throw new Error('--wifi-ssid is required when --content-type wifi');
  if (contentType === 'email' && !options.email.recipient) throw new Error('--email-recipient is required when --content-type email');
  if (contentType === 'sms' && !options.sms.recipient) throw new Error('--sms-recipient is required when --content-type sms');
  if (contentType === 'calendar') {
    if (!options.calendar.eventName) throw new Error('--calendar-event-name is required when --content-type calendar');
    validateDate(options.calendar.startDate, '--calendar-start-date');
    validateDate(options.calendar.endDate, '--calendar-end-date');
    validateTime(options.calendar.startTime, '--calendar-start-time');
    validateTime(options.calendar.endTime, '--calendar-end-time');
  }

  validateModelOptions(options, 'qr');
  return options;
};

const buildTextOptions = async (args) => {
  const options = clone(textDefaultOptions);
  if (has(args, 'options-json')) mergeDeep(options, JSON.parse(await fs.readFile(args['options-json'], 'utf8')));
  applyBaseOptions(args, options);
  applyCodeOptions(args, options);
  if (has(args, 'text')) options.base.textMessage = String(args.text);
  if (!options.base.textMessage) throw new Error('--base-text-message or --text is required in text mode');
  validateModelOptions(options, 'text');
  return options;
};

const buildSpotifyOptions = async (args) => {
  const options = clone(spotifyDefaultOptions);
  if (has(args, 'options-json')) mergeDeep(options, JSON.parse(await fs.readFile(args['options-json'], 'utf8')));
  applyString(args, options, 'spotify-uri', ['spotifyUri']);
  applyBaseOptions(args, options);
  applyCodeOptions(args, options);
  if (!options.spotifyUri && !has(args, 'spotify-svg')) {
    throw new Error('--spotify-uri or --spotify-svg is required in spotify mode');
  }
  validateModelOptions(options, 'spotify');
  return options;
};

const processSvgShapes = async (svgMarkup, trim = false) => {
  const svgData = new SVGLoader().parse(svgMarkup.replace(/currentColor/g, '#000000'));
  const processedShapes = [];
  svgData.paths.forEach((svgPath) => {
    SVGLoader.createShapes(svgPath).forEach((shape) => {
      processedShapes.push({
        shape: shape.toJSON(),
        holes: shape.holes ? shape.holes.map(hole => hole.toJSON()) : [],
      });
    });
  });
  if (processedShapes.length === 0) throw new Error('No valid SVG shapes found');
  return trim ? trimIconShapesBounds(processedShapes) : processedShapes;
};

const loadIconShapes = async (args, options) => {
  if (has(args, 'icon-svg')) {
    options.code.iconName = 'custom-cli';
    options.code.iconShapes = await processSvgShapes(await fs.readFile(args['icon-svg'], 'utf8'), true);
    if (!has(args, 'error-correction')) options.errorCorrectionLevel = 'H';
    return;
  }
  if (!options.code.iconName || options.code.iconName === 'none') return;
  const projectRoot = await findProjectRoot();
  const iconPath = path.join(projectRoot, 'public', 'icons', `${options.code.iconName}.svg`);
  options.code.iconShapes = await processSvgShapes(await fs.readFile(iconPath, 'utf8'), true);
  if (!has(args, 'error-correction')) options.errorCorrectionLevel = 'H';
};

const applyLowCorrectionIconDefaults = (args, options) => {
  if (!options.code.iconShapes || options.errorCorrectionLevel !== 'L') return;
  if (!has(args, 'icon-margin')) options.code.iconBlockMargin = 0;
  if (!has(args, 'icon-size')) {
    options.code.iconSizeRatio = Math.min(options.code.iconSizeRatio, 8);
    console.warn('Warning: --error-correction L with an icon is fragile; reducing icon size to 8%. Use --icon-size to override.');
  } else if (options.code.iconSizeRatio > 8) {
    console.warn('Warning: --error-correction L with --icon-size above 8 may be unscannable.');
  }
};

const pointInPolygon = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
};

const setPixel = (png, x, y, color) => {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const index = (png.width * y + x) << 2;
  png.data[index] = color[0];
  png.data[index + 1] = color[1];
  png.data[index + 2] = color[2];
  png.data[index + 3] = 255;
};

const fillRect = (png, x, y, width, height, color) => {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(png.width, Math.ceil(x + width));
  const endY = Math.min(png.height, Math.ceil(y + height));
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      setPixel(png, px, py, color);
    }
  }
};

const fillRoundedRect = (png, x, y, width, height, radius, color) => {
  if (radius <= 0) {
    fillRect(png, x, y, width, height, color);
    return;
  }
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(png.width, Math.ceil(x + width));
  const endY = Math.min(png.height, Math.ceil(y + height));
  const r = Math.min(radius, width / 2, height / 2);
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      const nearestX = Math.max(x + r, Math.min(cx, x + width - r));
      const nearestY = Math.max(y + r, Math.min(cy, y + height - r));
      if ((cx - nearestX) ** 2 + (cy - nearestY) ** 2 <= r ** 2) {
        setPixel(png, px, py, color);
      }
    }
  }
};

const isFinderPatternModule = (x, y, moduleCount) => {
  const finderSize = 7;
  const maxFinderStart = moduleCount - finderSize;
  return (x < finderSize && y < finderSize)
    || (x >= maxFinderStart && y < finderSize)
    || (x < finderSize && y >= maxFinderStart);
};

const getIconPolygons = (iconShapes) => {
  const polygons = [];
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };

  iconShapes.forEach((shapeData) => {
    const shape = new THREE.Shape().fromJSON(shapeData.shape || shapeData);
    const outer = shape.getPoints(64);
    const holes = (shapeData.holes || []).map(holeData => new THREE.Path().fromJSON(holeData).getPoints(64));
    polygons.push({ outer, holes });
    [outer, ...holes].flat().forEach((point) => {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    });
  });

  return { polygons, bounds };
};

const getIconDrawMetrics = (iconShapes, x, y, size) => {
  if (!iconShapes || iconShapes.length === 0 || size <= 0) return;
  const { polygons, bounds } = getIconPolygons(iconShapes);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

  const scale = Math.min(size / width, size / height);
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  const offsetX = x + (size - drawnWidth) / 2;
  const offsetY = y + (size - drawnHeight) / 2;
  return {
    polygons,
    bounds,
    scale,
    drawnWidth,
    drawnHeight,
    offsetX,
    offsetY,
  };
};

const drawIcon = (png, iconShapes, x, y, size) => {
  const metrics = getIconDrawMetrics(iconShapes, x, y, size);
  if (!metrics) return;
  const {
    polygons,
    bounds,
    scale,
    offsetX,
    offsetY,
  } = metrics;
  const black = [0, 0, 0];

  for (let py = Math.floor(y); py < Math.ceil(y + size); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + size); px += 1) {
      const shapePoint = {
        x: (px + 0.5 - offsetX) / scale + bounds.minX,
        y: bounds.maxY - (py + 0.5 - offsetY) / scale,
      };
      const isFilled = polygons.some(({ outer, holes }) => (
        pointInPolygon(shapePoint, outer)
        && !holes.some(hole => pointInPolygon(shapePoint, hole))
      ));
      if (isFilled) setPixel(png, px, py, black);
    }
  }
};

const writeQRPreviewPng = async (filePath, qrCodeObject, options, generator) => {
  const moduleCount = qrCodeObject.modules.size;
  const scale = Math.max(4, Math.ceil(164 / (moduleCount + 8)));
  const margin = 4;
  const imageSize = (moduleCount + margin * 2) * scale;
  const png = new PNG({ width: imageSize, height: imageSize });
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  fillRect(png, 0, 0, imageSize, imageSize, white);

  for (let y = 0; y < moduleCount; y += 1) {
    for (let x = 0; x < moduleCount; x += 1) {
      if (!qrCodeObject.modules.data[y * moduleCount + x]) continue;
      const fillSize = scale * (options.code.blockSizeMultiplier / 100);
      const offset = (scale - fillSize) / 2;
      const radius = isFinderPatternModule(x, y, moduleCount)
        ? 0
        : Math.min(
          fillSize / 2,
          ((Number(options.code.blockCornerRadius) || 0) / generator.blockWidth) * fillSize,
        );
      fillRoundedRect(
        png,
        (x + margin) * scale + offset,
        (y + margin) * scale + offset,
        fillSize,
        fillSize,
        radius,
        black,
      );
    }
  }

  if (options.code.iconShapes && options.code.iconShapes.length > 0) {
    const qrPixelSize = moduleCount * scale;
    const iconSize = qrPixelSize * (options.code.iconSizeRatio / 100);
    const clearPadding = Math.min(scale * (options.code.iconBlockMargin ?? 1.5), imageSize * 0.04);
    const iconBoxX = (imageSize - iconSize) / 2;
    const iconBoxY = (imageSize - iconSize) / 2;
    const metrics = getIconDrawMetrics(options.code.iconShapes, iconBoxX, iconBoxY, iconSize);
    if (metrics) {
      fillRect(
        png,
        metrics.offsetX - clearPadding,
        metrics.offsetY - clearPadding,
        metrics.drawnWidth + clearPadding * 2,
        metrics.drawnHeight + clearPadding * 2,
        white,
      );
      drawIcon(png, options.code.iconShapes, iconBoxX, iconBoxY, iconSize);
    }
  }

  await fs.writeFile(filePath, PNG.sync.write(png));
};

const spotifyUriFromInput = (input) => {
  if (input.startsWith('spotify:')) return input;
  const regex = /spotify\.com\/(?:.*\/)*([^/]+)\/([^?/]+)/gm;
  const parts = regex.exec(input);
  if (!parts || parts.length !== 3) throw new Error('Not a valid Spotify URI or link');
  return `spotify:${parts[1]}:${parts[2]}`;
};

const loadSpotifyShapes = async (args, options) => {
  let svg;
  if (has(args, 'spotify-svg')) {
    svg = await fs.readFile(args['spotify-svg'], 'utf8');
  } else {
    const uri = spotifyUriFromInput(options.spotifyUri);
    const response = await fetch(`https://scannables.scdn.co/uri/plain/svg/000000/white/640/${uri}`);
    if (!response.ok) throw new Error(`Failed to download Spotify code SVG: ${response.status} ${response.statusText}`);
    svg = await response.text();
  }
  svg = svg.replace('<rect x="0" y="0" width="400" height="100" fill="#000000"/>', '');
  return processSvgShapes(await pathThatSvg(svg));
};

const writeSTL = async (filePath, data) => {
  if (typeof data === 'string') {
    await fs.writeFile(filePath, data, 'utf8');
    return;
  }
  if (data instanceof DataView) {
    await fs.writeFile(filePath, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    return;
  }
  if (ArrayBuffer.isView(data)) {
    await fs.writeFile(filePath, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    return;
  }
  await fs.writeFile(filePath, Buffer.from(data));
};

const exportMeshes = async ({ generator, outputDir, filename, format, separateParts }) => {
  const exporter = new STLExporter();
  const parts = generator.getPartMeshes();
  const binary = format === 'binary';
  const written = [];

  if (separateParts) {
    await Promise.all(Object.entries(parts)
      .filter(([key]) => key !== 'combined')
      .map(async ([key, mesh]) => {
        const filePath = path.join(outputDir, `${filename}-${key}.stl`);
        await writeSTL(filePath, exporter.parse(mesh, { binary }));
        written.push(filePath);
      }));
  } else {
    const filePath = path.join(outputDir, `${filename}.stl`);
    await writeSTL(filePath, exporter.parse(parts.combined, { binary }));
    written.push(filePath);
  }

  return written.sort();
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(help);
    return;
  }

  const mode = str(args, 'mode') || 'qr';
  validateEnum(mode, ['qr', 'text', 'spotify'], '--mode');
  const outputDir = str(args, 'output-dir');
  if (!outputDir) throw new Error('--output-dir is required');
  const format = str(args, 'format') || 'binary';
  validateEnum(format, ['binary', 'ascii'], '--format');
  const filename = str(args, 'filename') || `${mode}-${Date.now()}`;

  await fs.mkdir(outputDir, { recursive: true });

  let generator;
  let previewPngPath = null;
  if (mode === 'qr') {
    const options = await buildQROptions(args);
    await loadIconShapes(args, options);
    applyLowCorrectionIconDefaults(args, options);
    const qrText = getQRText(options);
    if (!qrText) throw new Error('QR content cannot be empty');
    const qrCodeObject = await qrcode.create(qrText, { errorCorrectionLevel: options.errorCorrectionLevel });
    generator = new QRCode3D(qrCodeObject.modules.data, options);
    previewPngPath = path.join(outputDir, `${filename}.png`);
    await writeQRPreviewPng(previewPngPath, qrCodeObject, options, generator);
    console.log(`QR settings: errorCorrection=${options.errorCorrectionLevel}, modules=${generator.maskWidth}x${generator.maskWidth}, blockWidth=${generator.blockWidth.toFixed(3)}mm, blockCornerRadius=${options.code.blockCornerRadius}mm, iconSize=${options.code.iconSizeRatio}%, iconBlockMargin=${options.code.iconBlockMargin}`);
  } else if (mode === 'text') {
    generator = new BaseTag3D(await buildTextOptions(args));
  } else {
    const options = await buildSpotifyOptions(args);
    generator = new SpotifyCode3D(await loadSpotifyShapes(args, options), options);
  }

  await generator.generate3dModel();
  const written = await exportMeshes({
    generator,
    outputDir,
    filename,
    format,
    separateParts: bool(args, 'separate-parts'),
  });

  console.log(`Wrote ${written.length} STL file${written.length === 1 ? '' : 's'}:`);
  written.forEach(filePath => console.log(filePath));
  if (previewPngPath) {
    console.log('Wrote QR preview PNG:');
    console.log(previewPngPath);
  }
};

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
