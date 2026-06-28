/**
 * Weyland-Yutani Asset Label Generator
 * Building Better Worlds - Asset Tracking System
 * Inspired by the Alien movie trilogy
 */

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Weyland-Yutani Corp - Asset Tracking</title>
    <script src="https://cdn.jsdelivr.net/npm/qr-code-styling@1.5.0/lib/qr-code-styling.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Roboto+Mono:wght@400;500;700&family=Orbitron:wght@400;500;600;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        :root {
            --wy-yellow: #ffaa00;
            --wy-amber: #ff6b00;
            --wy-dark: #0a0a0a;
            --wy-gray: #1a1a1a;
            --wy-light: #e0e0e0;
            --wy-border: #333;
        }
        
        body {
            font-family: 'Roboto Mono', monospace;
            background: var(--wy-dark);
            min-height: 100vh;
            color: var(--wy-light);
            overflow-x: hidden;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        /* Header */
        .header {
            text-align: center;
            padding: 20px 0 30px;
            border-bottom: 3px solid var(--wy-yellow);
            margin-bottom: 30px;
            position: relative;
        }
        
        .wy-logo {
            width: 80px;
            height: 80px;
            margin: 0 auto 15px;
            object-fit: contain;
            filter: invert(1);
        }

        .label-logo {
            height: 30px;
            width: auto;
            object-fit: contain;
            filter: invert(1);
        }
        
        .dod-label.size-50x30 .label-logo,
        .dod-label.size-20x30 .label-logo {
            height: 20px;
        }
        
        .header h1 {
            font-family: 'Orbitron', sans-serif;
            font-size: 2rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 6px;
            color: var(--wy-yellow);
            text-shadow: 0 0 20px rgba(255, 170, 0, 0.5);
        }
        
        .header .subtitle {
            font-size: 13px;
            color: #888;
            letter-spacing: 4px;
            margin-top: 8px;
            font-style: italic;
        }
        
        /* Simple B&W Toggle */
        .bw-toggle {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--wy-border);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .bw-toggle input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
            accent-color: var(--wy-yellow);
        }
        
        .bw-toggle label {
            cursor: pointer;
        }
        
        /* Control Panel */
        .control-panel {
            background: var(--wy-gray);
            border: 1px solid var(--wy-border);
            border-radius: 8px;
            padding: 30px;
            margin-bottom: 30px;
        }
        
        .panel-title {
            font-family: 'Orbitron', sans-serif;
            font-size: 1.1rem;
            color: var(--wy-yellow);
            text-transform: uppercase;
            letter-spacing: 3px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .panel-title::before {
            content: '◆';
            color: var(--wy-yellow);
        }
        
        .form-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
        }
        
        .form-group label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 2px;
            color: #888;
            margin-bottom: 8px;
        }
        
        .form-group input,
        .form-group select {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--wy-border);
            border-radius: 4px;
            padding: 12px 15px;
            color: var(--wy-light);
            font-family: 'Roboto Mono', monospace;
            font-size: 14px;
            transition: all 0.3s ease;
        }
        
        .form-group input:focus,
        .form-group select:focus {
            outline: none;
            border-color: var(--wy-yellow);
            box-shadow: 0 0 10px rgba(255, 170, 0, 0.3);
        }
        
        .form-group input::placeholder {
            color: #666;
        }
        
        /* Classification Levels */
        .classification-select {
            cursor: pointer;
        }
        
        .classification-select option[value="UNCLASSIFIED"] { color: #4ade80; }
        .classification-select option[value="CONFIDENTIAL"] { color: #60a5fa; }
        .classification-select option[value="SECRET"] { color: #fbbf24; }
        .classification-select option[value="TOP SECRET"] { color: #f87171; }
        
        /* Buttons */
        .button-group {
            display: flex;
            gap: 15px;
            margin-top: 25px;
            flex-wrap: wrap;
        }
        
        .btn {
            font-family: 'Orbitron', sans-serif;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 2px;
            padding: 15px 30px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, var(--wy-yellow), var(--wy-amber));
            color: var(--wy-dark);
            font-weight: 600;
        }
        
        .btn-primary:hover {
            box-shadow: 0 0 30px rgba(255, 170, 0, 0.5);
            transform: translateY(-2px);
        }
        
        .btn-secondary {
            background: transparent;
            color: #888;
            border: 1px solid var(--wy-border);
        }
        
        .btn-secondary:hover {
            border-color: var(--wy-yellow);
            color: var(--wy-yellow);
        }
        
        /* Label Preview */
        .preview-section {
            background: var(--wy-gray);
            border: 1px solid var(--wy-border);
            border-radius: 8px;
            padding: 30px;
        }
        
        #label-container {
            display: flex;
            justify-content: center;
            padding: 40px;
            background: repeating-linear-gradient(
                45deg,
                rgba(255, 215, 0, 0.03),
                rgba(255, 215, 0, 0.03) 10px,
                transparent 10px,
                transparent 20px
            );
            border-radius: 8px;
        }
        
        /* The DoD Label */
        .dod-label {
            width: 600px;
            background: #fff;
            border: 3px solid #000;
            position: relative;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }
        
        /* Label sizes - 50x30mm and 20x30mm at 300dpi */
        .dod-label.size-50x30 {
            width: 590px;
            height: 354px;
        }
        
        .dod-label.size-20x30 {
            width: 236px;
            height: 354px;
        }
        
        /* Small labels: data on left, QR on right, hide banner */
        .dod-label.size-50x30 .classification-banner,
        .dod-label.size-20x30 .classification-banner {
            display: none;
        }
        
        .dod-label.size-50x30 .label-body,
        .dod-label.size-20x30 .label-body {
            grid-template-columns: 1fr auto;
            gap: 15px;
            padding: 15px;
            height: calc(100% - 60px);
            align-items: center;
        }
        
        .dod-label.size-50x30 .label-info,
        .dod-label.size-20x30 .label-info {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .dod-label.size-50x30 .info-row,
        .dod-label.size-20x30 .info-row {
            grid-template-columns: auto 1fr;
            gap: 5px;
        }
        
        .dod-label.size-50x30 .info-label,
        .dod-label.size-20x30 .info-label {
            font-size: 8px;
        }
        
        .dod-label.size-50x30 .info-value,
        .dod-label.size-20x30 .info-value {
            font-size: 11px;
        }
        
        .dod-label.size-50x30 .qr-section,
        .dod-label.size-20x30 .qr-section {
            display: flex !important;
            transform: none;
        }
        
        .dod-label.size-50x30 .qr-section .qr-caption,
        .dod-label.size-20x30 .qr-section .qr-caption {
            display: none;
        }
        
        .dod-label.size-20x30 .label-body {
            grid-template-columns: 1fr;
            justify-items: center;
        }
        
        .dod-label.size-20x30 .label-info {
            display: none;
        }
        
        .dod-label.size-20x30 .qr-section {
            transform: scale(1.3);
        }
        
        /* QR Styling UI */
        .qr-style-options {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid var(--wy-border);
        }
        
        .qr-style-option {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        
        .qr-style-option label {
            font-size: 10px;
            text-transform: uppercase;
            color: #888;
        }
        
        .qr-style-option select {
            background: var(--wy-dark);
            color: var(--wy-light);
            border: 1px solid var(--wy-border);
            padding: 5px;
            font-family: inherit;
            font-size: 12px;
        }
        
        /* B&W Mode for Label */
        .dod-label.bw-mode {
            filter: grayscale(100%) contrast(120%);
        }
        
        .dod-label.bw-mode .classification-banner {
            background: #333 !important;
            color: #fff !important;
            border-color: #000 !important;
        }
        
        .label-header {
            background: #000;
            color: #fff;
            padding: 8px 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .dod-seal {
            font-family: 'Oswald', sans-serif;
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 2px;
        }
        
        .nsn {
            font-size: 11px;
            color: #888;
        }
        
        .classification-banner {
            padding: 12px;
            text-align: center;
            font-family: 'Oswald', sans-serif;
            font-size: 24px;
            font-weight: 700;
            letter-spacing: 12px;
            text-transform: uppercase;
            border-bottom: 3px solid #000;
        }
        
        .classification-banner.minimal { background: #22c55e; color: #000; }
        .classification-banner.moderate { background: #f59e0b; color: #000; }
        .classification-banner.extreme { background: #dc2626; color: #fff; }
        .classification-banner.biohazard { background: #7c3aed; color: #fff; }
        .classification-banner.quarantine { background: #000; color: #ef4444; border: 2px solid #ef4444; }
        
        .label-body {
            padding: 20px;
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 20px;
            background: #fff;
        }
        
        .label-info {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .info-row {
            display: grid;
            grid-template-columns: 120px 1fr;
            gap: 10px;
            align-items: center;
        }
        
        .info-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #666;
            font-weight: 700;
        }
        
        .info-value {
            font-size: 14px;
            color: #000;
            font-weight: 500;
            border-bottom: 1px solid #ddd;
            padding-bottom: 2px;
        }
        
        .qr-section {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
        }
        
        #qrcode {
            background: #fff;
            padding: 10px;
            border: 1px solid #000;
        }
        
        .qr-caption {
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #666;
            text-align: center;
        }
        
        .label-footer {
            background: #f5f5f5;
            border-top: 1px solid #000;
            padding: 10px 15px;
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #666;
        }
        
        .barcode-placeholder {
            font-family: 'Libre Barcode 39', monospace;
            font-size: 40px;
            color: #000;
        }
        
        /* Warning Strip */
        .warning-strip {
            height: 8px;
            background: repeating-linear-gradient(
                90deg,
                #ffd700,
                #ffd700 20px,
                #000 20px,
                #000 40px
            );
        }
        
        /* Print Styles */
        @media print {
            body { background: #fff; }
            .control-panel, .preview-section > *:not(#label-container) { display: none; }
            #label-container { background: none; }
            .dod-label { box-shadow: none; }
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .header h1 { font-size: 1.5rem; letter-spacing: 4px; }
            .header::before, .header::after { display: none; }
            .dod-label { width: 100%; max-width: 400px; }
            .label-body { grid-template-columns: 1fr; }
            .info-row { grid-template-columns: 100px 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <!-- Weyland-Yutani Logo -->
            <img class="wy-logo" src="/wy-logo.png" alt="Weyland-Yutani">
            <h1>Weyland-Yutani</h1>
            <div class="subtitle">Building Better Worlds // Asset Tracking System</div>
        </header>
        
        <div class="control-panel">
            <div class="panel-title">Asset Configuration</div>
            <div class="form-grid">
                <div class="form-group">
                    <label for="url-input">Data to Encode</label>
                    <input type="text" id="url-input" placeholder="Asset tracking data or URL">
                </div>
                <div class="form-group">
                    <label for="asset-id">Asset ID (WY-XXXX-XXX)</label>
                    <input type="text" id="asset-id" placeholder="WY-2187-842" value="WY-2187-842">
                </div>
                <div class="form-group">
                    <label for="item-name">Product Name</label>
                    <input type="text" id="item-name" placeholder="Product designation" value="Atmosphere Processing Unit">
                </div>
                <div class="form-group">
                    <label for="facility">Facility / Colony</label>
                    <input type="text" id="facility" placeholder="Facility name" value="Hadley's Hope">
                </div>
                <div class="form-group">
                    <label for="sector">Sector / Deck</label>
                    <input type="text" id="sector" placeholder="Location" value="Sector 7G // Operations">
                </div>
                <div class="form-group">
                    <label for="classification">Hazard Class</label>
                    <select id="classification" class="classification-select">
                        <option value="MINIMAL">MINIMAL HAZARD</option>
                        <option value="MODERATE" selected>MODERATE HAZARD</option>
                        <option value="EXTREME">EXTREME HAZARD</option>
                        <option value="BIOHAZARD">BIOHAZARD</option>
                        <option value="QUARANTINE">QUARANTINE</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="operator">Assigned Operator</label>
                    <input type="text" id="operator" placeholder="Operator name/ID" value="Ripley, E. - WY-0451">
                </div>
                <div class="form-group">
                    <label for="manifest">Manifest / Batch</label>
                    <input type="text" id="manifest" placeholder="Manifest number" value="USCSS-NOSTROMO-1802">
                </div>
                <div class="form-group">
                    <label for="date">Installation Date</label>
                    <input type="text" id="date" placeholder="DD MMM YYYY">
                </div>
                <div class="form-group">
                    <label for="status">Status</label>
                    <input type="text" id="status" placeholder="Status" value="OPERATIONAL">
                </div>
                <div class="form-group">
                    <label for="weight">Mass / Dimensions</label>
                    <input type="text" id="weight" placeholder="Weight/dimensions" value="2.4 MT // 4.2x3.1x2.8m">
                </div>
                <div class="form-group">
                    <label for="serial">Serial Number</label>
                    <input type="text" id="serial" placeholder="Serial" value="WY-M-2187-001">
                </div>
            </div>
            
            <!-- B&W Label Toggle -->
            <div class="bw-toggle">
                <input type="checkbox" id="bw-mode" onchange="generateLabel()">
                <label for="bw-mode">Print in Black & White (no color)</label>
            </div>
            
            <!-- Label Size Selection -->
            <div class="bw-toggle" style="margin-top: 10px;">
                <label for="label-size">Label Size:</label>
                <select id="label-size" onchange="generateLabel()" style="background: var(--wy-dark); color: var(--wy-light); border: 1px solid var(--wy-border); padding: 5px; font-family: inherit;">
                    <option value="default">Default (600px wide)</option>
                    <option value="50x30">50x30mm (590 x 354 px @ 300dpi)</option>
                    <option value="20x30">20x30mm (236 x 354 px @ 300dpi)</option>
                </select>
            </div>
            
            <!-- QR Styling Options -->
            <div class="qr-style-options">
                <div class="qr-style-option">
                    <label for="qr-dots">Dots Style</label>
                    <select id="qr-dots" onchange="generateLabel()">
                        <option value="square">Square</option>
                        <option value="rounded">Rounded</option>
                        <option value="dots">Dots</option>
                        <option value="classy">Classy</option>
                        <option value="classy-rounded">Classy Rounded</option>
                    </select>
                </div>
                <div class="qr-style-option">
                    <label for="qr-corners">Corner Style</label>
                    <select id="qr-corners" onchange="generateLabel()">
                        <option value="square">Square</option>
                        <option value="rounded">Rounded</option>
                        <option value="circle">Circle</option>
                        <option value="extra-rounded">Extra Rounded</option>
                    </select>
                </div>
                <div class="qr-style-option">
                    <label for="qr-corner-dot">Corner Dot</label>
                    <select id="qr-corner-dot" onchange="generateLabel()">
                        <option value="square">Square</option>
                        <option value="rounded">Rounded</option>
                        <option value="circle">Circle</option>
                    </select>
                </div>
            </div>
            
            <div class="button-group">
                <button class="btn btn-primary" onclick="generateLabel()">
                    <span>◆</span> Generate Label
                </button>
                <button class="btn btn-secondary" onclick="downloadLabel()">
                    <span>▼</span> Download PNG
                </button>
                <button class="btn btn-secondary" onclick="printLabel()">
                    <span>⎙</span> Print Label
                </button>
                <button class="btn btn-secondary" onclick="randomizeLabel()">
                    <span>↻</span> Randomize
                </button>
            </div>
        </div>
        
        <div class="preview-section">
            <div class="panel-title">Asset Label Preview</div>
            <div id="label-container">
                <div class="dod-label" id="dod-label">
                    <div class="warning-strip"></div>
                    <div class="label-header">
                        <img class="label-logo" src="/wy-logo.png" alt="WY">
                        <div class="nsn" id="preview-asset-header">WY-2187-842</div>
                    </div>
                    <div class="classification-banner secret" id="class-banner">MODERATE HAZARD</div>
                    <div class="label-body">
                        <div class="label-info">
                            <div class="info-row">
                                <div class="info-label">Asset ID</div>
                                <div class="info-value" id="preview-asset">WY-2187-842</div>
                            </div>
                            <div class="info-row">
                                <div class="info-label">Product</div>
                                <div class="info-value" id="preview-item">Atmosphere Processing Unit</div>
                            </div>
                            <div class="info-row">
                                <div class="info-label">Facility</div>
                                <div class="info-value" id="preview-facility">Hadley's Hope</div>
                            </div>
                            <div class="info-row">
                                <div class="info-label">Location</div>
                                <div class="info-value" id="preview-sector">Sector 7G // Operations</div>
                            </div>
                            <div class="info-row">
                                <div class="info-label">Operator</div>
                                <div class="info-value" id="preview-operator">Ripley, E. - WY-0451</div>
                            </div>
                            <div class="info-row">
                                <div class="info-label">Manifest</div>
                                <div class="info-value" id="preview-manifest">USCSS-NOSTROMO-1802</div>
                            </div>
                            <div class="info-row">
                                <div class="info-label">Status</div>
                                <div class="info-value" id="preview-status">OPERATIONAL</div>
                            </div>
                            <div class="info-row">
                                <div class="info-label">Mass / Specs</div>
                                <div class="info-value" id="preview-weight">2.4 MT // 4.2x3.1x2.8m</div>
                            </div>
                            <div class="info-row">
                                <div class="info-label">Date / Serial</div>
                                <div class="info-value" id="preview-date-serial">-- / WY-M-2187-001</div>
                            </div>
                        </div>
                        <div class="qr-section">
                            <div id="qrcode"></div>
                            <div class="qr-caption">SCAN FOR ASSET DATA<br>AUTHORIZED PERSONNEL ONLY</div>
                        </div>
                    </div>
                    <div class="label-footer">
                        <div>BUILDING BETTER WORLDS</div>
                        <div id="footer-doc">WY-CORP-2187 // LV-426</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        console.log('[DEBUG] Script starting...');
        
        let currentQR = null;
        
        // Set today's date in DoD format (DD MMM YYYY)
        const today = new Date();
        const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const dodDate = today.getDate().toString().padStart(2, '0') + ' ' + monthNames[today.getMonth()] + ' ' + today.getFullYear();
        console.log('[DEBUG] Setting date to:', dodDate);
        document.getElementById('date').value = dodDate;
        
        function generateLabel() {
            console.log('[DEBUG] generateLabel() called');
            
            const url = document.getElementById('url-input').value || 'https://tissue.systems';
            const item = document.getElementById('item-name').value || 'Product Unnamed';
            const classification = document.getElementById('classification').value;
            const assetId = document.getElementById('asset-id').value || 'WY-UNKNOWN';
            const facility = document.getElementById('facility').value || '';
            const sector = document.getElementById('sector').value || '';
            const operator = document.getElementById('operator').value || '';
            const manifest = document.getElementById('manifest').value || '';
            const date = document.getElementById('date').value || '';
            const status = document.getElementById('status').value || '';
            const weight = document.getElementById('weight').value || '';
            const serial = document.getElementById('serial').value || '';
            const bwMode = document.getElementById('bw-mode')?.checked || false;
            const labelSize = document.getElementById('label-size')?.value || 'default';
            
            console.log('[DEBUG] Form values:', { url, item, classification, assetId, bwMode, labelSize });
            
            // Handle B&W mode and size for label
            const label = document.getElementById('dod-label');
            if (bwMode) {
                console.log('[DEBUG] Applying B&W mode to label');
                label.classList.add('bw-mode');
            } else {
                label.classList.remove('bw-mode');
            }
            
            // Handle label size
            label.classList.remove('size-50x30', 'size-20x30');
            if (labelSize === '50x30') {
                console.log('[DEBUG] Applying 50x30mm size');
                label.classList.add('size-50x30');
            } else if (labelSize === '20x30') {
                console.log('[DEBUG] Applying 20x30mm size');
                label.classList.add('size-20x30');
            }
            
            // Update hazard banner
            const banner = document.getElementById('class-banner');
            banner.textContent = classification;
            const bannerClass = classification.toLowerCase().replace(' ', '-');
            banner.className = 'classification-banner ' + bannerClass;
            
            // Update header
            document.getElementById('preview-asset-header').textContent = assetId;
            
            // Update info fields
            document.getElementById('preview-asset').textContent = assetId;
            document.getElementById('preview-item').textContent = item;
            document.getElementById('preview-facility').textContent = facility;
            document.getElementById('preview-sector').textContent = sector;
            document.getElementById('preview-operator').textContent = operator;
            document.getElementById('preview-manifest').textContent = manifest;
            document.getElementById('preview-status').textContent = status;
            document.getElementById('preview-weight').textContent = weight;
            document.getElementById('preview-date-serial').textContent = (date ? date + ' / ' : '-- / ') + serial;
            document.getElementById('footer-doc').textContent = 'WY-CORP-' + (assetId.split('-')[1] || '0000') + ' // LV-426';
            
            // Get QR styling options
            const qrDotsStyle = document.getElementById('qr-dots')?.value || 'square';
            const qrCornersStyle = document.getElementById('qr-corners')?.value || 'square';
            const qrCornerDotStyle = document.getElementById('qr-corner-dot')?.value || 'square';
            
            // Generate QR code with qr-code-styling
            console.log('[DEBUG] Starting QR code generation...');
            const qrContainer = document.getElementById('qrcode');
            console.log('[DEBUG] QR container found:', !!qrContainer);
            
            qrContainer.innerHTML = '';
            
            // Check if QRCode library is loaded
            if (typeof QRCodeStyling === 'undefined') {
                console.error('[ERROR] QRCodeStyling library not loaded!');
                qrContainer.innerHTML = '<div style="color:red;font-size:10px">QR Library Error</div>';
                return;
            }
            console.log('[DEBUG] QRCodeStyling library is available');
            
            try {
                // Adjust QR size based on label size
                const qrSize = labelSize === '20x30' ? 80 : (labelSize === '50x30' ? 100 : 128);
                console.log('[DEBUG] QR size:', qrSize, 'dots:', qrDotsStyle, 'corners:', qrCornersStyle, 'cornerDot:', qrCornerDotStyle);
                
                currentQR = new QRCodeStyling({
                    width: qrSize,
                    height: qrSize,
                    type: 'svg',
                    data: url,
                    dotsOptions: {
                        color: '#000000',
                        type: qrDotsStyle
                    },
                    cornersSquareOptions: {
                        color: '#000000',
                        type: qrCornersStyle
                    },
                    cornersDotOptions: {
                        color: '#000000',
                        type: qrCornerDotStyle
                    },
                    backgroundOptions: {
                        color: '#ffffff'
                    },
                    imageOptions: {
                        crossOrigin: 'anonymous',
                        margin: 5
                    }
                });
                
                console.log('[DEBUG] QRCodeStyling object created');
                currentQR.append(qrContainer);
                console.log('[DEBUG] QR appended to container');
                
            } catch (err) {
                console.error('[ERROR] QR generation failed:', err);
                qrContainer.innerHTML = '<div style="color:red;font-size:10px">QR Gen Failed: ' + err.message + '</div>';
            }
            
            // Store URL for download
            qrContainer.setAttribute('data-url', url);
            console.log('[DEBUG] generateLabel() complete');
        }
        
        // Weyland-Yutani themed data pools
        const PRODUCTS = [
            'Atmosphere Processing Unit', 'Power Loader P-5000', 'Cryo-Stasis Pod', 'MU-TH-UR 6000 Interface',
            'Motion Tracker', 'M314 Motion Tracker', 'Flame Unit', 'Survival Knife',
            'Colonial Administration Terminal', 'Hydroponics Bay Module', 'Airlock Control System',
            'Emergency Beacon', 'Surface-to-Orbit Shuttle', 'Med-Lab Autodoc', 'Laboratory Analysis Unit',
            'Specimen Containment Cell', 'Terraforming Controller', 'Communication Relay',
            'Seismic Survey Equipment', 'Ore Extractor', 'Water Reclamation Unit', 'Atmospheric Scrubber',
            'Gravity Generator', 'Particle Beam Weapon', 'Sentry Gun System', 'Colonial Marine Smartgun',
            'M41A Pulse Rifle', 'M56 Smartgun', 'M240 Incinerator Unit', 'UA 571-C Sentry Gun',
            'Weyland-Yutani APC', 'Cheyenne Dropship', 'Conestoga-Class Transport', 'Narcissus Shuttle',
            'Nostromo-Type Towing Vehicle', 'USCSS Infirmary', 'Cargo Loading Exoskeleton',
            'Deep Space Suit', 'EVA Repair Unit', 'Fuel Cell Array', 'Ion Drive Engine'
        ];
        
        const COLONIES = [
            "Hadley's Hope", 'Fury 161', 'Acheron (LV-426)', 'Gateway Station', 'Sevastopol Station',
            'LV-1201', 'New Galveston', 'Thedus', 'Kadinche', 'Icharus', 'Olympus', 'Arceon',
            'Anchorpoint Station', 'Pyramid Outpost', 'Origin Facility', 'San Romero Station',
            'Freyas Prospect', 'BG-386', 'LV-742', 'Arias 5', 'Circe', 'Helene', 'Svarog'
        ];
        
        const SECTORS = [
            'Sector 7G // Operations', 'Deck C // Engineering', 'Level 2 // Medical',
            'Section 8 // Cargo Hold', 'Bay 12 // Loading', 'Sector 4 // Security',
            'Deck A // Command', 'Level 3 // Science Lab', 'Sector 9 // Communications',
            'Section 7 // Cryo-Sleep', 'Bay 4 // Shuttle Hangar', 'Deck D // Maintenance',
            'Level 1 // Bridge', 'Sector 6 // Armory', 'Section 3 // Hydroponics'
        ];
        
        const OPERATORS = [
            'Ripley, E. - WY-0451', 'Dallas, A. - WY-0001', 'Kane, T. - WY-0002', 'Lambert, J. - WY-0003',
            'Brett, S. - WY-0004', 'Parker, J. - WY-0005', 'Ash - WY-0006', 'Bishop - WY-3412',
            'Hicks, D. - USCM-777', 'Hudson, W. - USCM-417', 'Vasquez, J. - USCM-469',
            'Gorman, W. - USCM-240', 'Apone, A. - USCM-632', 'Drake, M. - USCM-505',
            'Frost, R. - USCM-721', 'Crowe, T. - USCM-334', 'Dietrich, C. - USCM-899',
            'Ferro, C. - USCM-112', 'Spunkmeyer, D. - USCM-267', 'Newt - CIV-2187',
            'Burke, C. - WY-7832', 'Bishop II - WY-9821', 'Clemens, J. - FURY-001',
            'Dillon, L. - FURY-002', 'Morse, W. - FURY-003', 'Andrews, H. - FURY-004'
        ];
        
        const MANIFESTS = [
            'USCSS-NOSTROMO-1802', 'USCSS-SULACO-2179', 'USCSS-PATNA-2401', 'USCSS-SEVASTOPOL-2110',
            'WY-COLTRANS-A-3', 'WY-MINING-VESSEL-4', 'WY-OUTPOST-42', 'WY-TERRAFORM-7',
            'COL-MARINE-EXPED-09', 'WY-RESEARCH-XEN-01', 'USCM-RESCUE-OPER-12',
            'WY-CARGO-ROUTE-88', 'COLONY-RESUPPLY-117', 'MEDIVAC-SHUTTLE-34'
        ];
        
        const STATUSES = ['OPERATIONAL', 'MAINTENANCE', 'OFFLINE', 'EMERGENCY', 'STANDBY', 'CRITICAL'];
        
        const WEIGHTS = [
            '2.4 MT // 4.2x3.1x2.8m', '500 kg // 1.8x1.2x0.9m', '45 MT // 12.4x8.2x6.1m',
            '125 kg // 2.1x1.5x1.2m', '8.5 MT // 6.2x4.8x3.5m', '2.1 MT // 3.8x2.4x1.9m'
        ];
        
        const SERIALS = [
            'WY-M-2187-001', 'WY-A-1802-042', 'WY-T-2179-783', 'WY-X-2401-999',
            'WY-C-2110-555', 'WY-P-2100-001', 'WY-S-2117-234', 'WY-L-2187-666'
        ];
        
        const HAZARDS = ['MINIMAL', 'MODERATE', 'EXTREME', 'BIOHAZARD', 'QUARANTINE'];
        
        function randomizeLabel() {
            // Generate WY Asset ID
            const wyId = Math.floor(Math.random() * 9000 + 1000);
            const assetId = 'WY-' + wyId + '-' + Math.floor(Math.random() * 900 + 100);
            
            // Select random values
            const product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
            const colony = COLONIES[Math.floor(Math.random() * COLONIES.length)];
            const sector = SECTORS[Math.floor(Math.random() * SECTORS.length)];
            const operator = OPERATORS[Math.floor(Math.random() * OPERATORS.length)];
            const manifest = MANIFESTS[Math.floor(Math.random() * MANIFESTS.length)];
            const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
            const weight = WEIGHTS[Math.floor(Math.random() * WEIGHTS.length)];
            const serial = SERIALS[Math.floor(Math.random() * SERIALS.length)] || 'WY-' + String.fromCharCode(65 + Math.floor(Math.random() * 26)) + '-' + wyId + '-' + Math.floor(Math.random() * 999);
            const hazard = HAZARDS[Math.floor(Math.random() * HAZARDS.length)];
            
            // Update form fields
            document.getElementById('asset-id').value = assetId;
            document.getElementById('item-name').value = product;
            document.getElementById('facility').value = colony;
            document.getElementById('sector').value = sector;
            document.getElementById('operator').value = operator;
            document.getElementById('manifest').value = manifest;
            document.getElementById('status').value = status;
            document.getElementById('weight').value = weight;
            document.getElementById('serial').value = serial;
            document.getElementById('classification').value = hazard;
            
            generateLabel();
        }
        
        function downloadLabel() {
            const label = document.getElementById('dod-label');
            const labelSize = document.getElementById('label-size')?.value || 'default';
            
            // Determine target dimensions based on selected size
            let targetWidth = 600;
            let targetHeight = null;
            if (labelSize === '50x30') {
                targetWidth = 590;
                targetHeight = 354;
            } else if (labelSize === '20x30') {
                targetWidth = 236;
                targetHeight = 354;
            }
            
            console.log('[DEBUG] Downloading with size:', labelSize, 'dimensions:', targetWidth, 'x', targetHeight);
            
            // Use html2canvas with specific dimensions
            html2canvas(label, {
                width: targetWidth,
                height: targetHeight,
                scale: 1
            }).then(canvas => {
                // Resize canvas to exact target dimensions if needed
                if (targetHeight && (canvas.width !== targetWidth || canvas.height !== targetHeight)) {
                    const resizedCanvas = document.createElement('canvas');
                    resizedCanvas.width = targetWidth;
                    resizedCanvas.height = targetHeight;
                    const ctx = resizedCanvas.getContext('2d');
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, 0, targetWidth, targetHeight);
                    ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
                    canvas = resizedCanvas;
                }
                
                const link = document.createElement('a');
                const serial = document.getElementById('serial').value || 'UNKNOWN';
                link.download = 'WY-Label-' + serial + '.png';
                link.href = canvas.toDataURL();
                link.click();
            });
        }
        
        function printLabel() {
            window.print();
        }
        
        // Auto-generate on load with debugging
        console.log('[DEBUG] Auto-generating label on page load...');
        setTimeout(() => {
            generateLabel();
        }, 500);
        
        // Live preview on input change
        console.log('[DEBUG] Setting up event listeners...');
        ['url-input', 'asset-id', 'item-name', 'facility', 'sector', 'operator', 'manifest', 'date', 'status', 'weight', 'serial', 'classification', 'bw-mode', 'label-size', 'qr-dots', 'qr-corners', 'qr-corner-dot'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                console.log('[DEBUG] Adding listener for:', id);
                el.addEventListener('input', generateLabel);
                el.addEventListener('change', generateLabel);
            } else {
                console.warn('[WARN] Element not found:', id);
            }
        });
        console.log('[DEBUG] Event listeners setup complete');
    </script>
    <script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }

    return env.FILES.fetch(request);
  }
};
