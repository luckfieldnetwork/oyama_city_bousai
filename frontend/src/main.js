import L from 'leaflet';
import * as turf from '@turf/turf';

// 小山市役所（初期中心位置・デフォルト基準地）
const OYAMA_CENTER = [36.3147, 139.8002];
const DEFAULT_ZOOM = 13;

// 災害種別定義
const DISASTER_INFO = {
  flood: { name: '洪水', icon: '🌊' },
  earthquake: { name: '地震', icon: '🏚️' },
  landslide: { name: '土砂災害', icon: '⛰️' },
  fire: { name: '火災', icon: '🔥' },
  inland_flood: { name: '内水氾濫', icon: '🌧️' },
};

// アプリケーション状態
const state = {
  map: null,
  hazardFloodLayer: null,
  sheltersLayerGroup: null,
  aedLayerGroup: null,
  medicalLayerGroup: null,
  toiletsLayerGroup: null,
  parksLayerGroup: null,
  shelterMarkerMap: new Map(), // id -> marker
  highlightMarker: null,       // 最寄りハイライト用マーカー
  currentLocationMarker: null,
  nearestLine: null,
  allShelters: [],
  allAed: [],
  allMedical: [],
  allToilets: [],
  allParks: [],
  currentFilter: 'all',
  userLocation: null,          // [lon, lat]
};

// 各種ピンアイコンの生成
function createShelterIcon(isFloodSafe = false) {
  const bgColor = isFloodSafe ? '#0284c7' : '#64748b';
  const html = `
    <div style="
      background-color: ${bgColor};
      width: 28px;
      height: 28px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <span style="transform: rotate(45deg); color: white; font-size: 13px; line-height: 1;">🏛️</span>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-shelter-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
}

function createHighlightShelterIcon() {
  const html = `
    <div class="highlight-ring-container" style="position: relative; width: 36px; height: 36px;">
      <div class="highlight-pulse-ring" style="
        position: absolute;
        top: -12px;
        left: -12px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: rgba(234, 88, 12, 0.4);
        border: 2px solid #ea580c;
        animation: pulse-ring 1.6s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
        pointer-events: none;
      "></div>
      <div style="
        position: relative;
        background-color: #ea580c;
        width: 36px;
        height: 36px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 3px solid #ffffff;
        box-shadow: 0 4px 12px rgba(234, 88, 12, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
      ">
        <span style="transform: rotate(45deg); color: white; font-size: 18px; line-height: 1;">🎯</span>
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'nearest-highlight-marker',
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
  });
}

function createAedIcon() {
  const html = `
    <div style="
      background-color: #d97706;
      width: 24px;
      height: 24px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 5px rgba(217, 119, 6, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <span style="transform: rotate(45deg); color: white; font-size: 13px; line-height: 1;">⚡</span>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-aed-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
  });
}

function createMedicalIcon() {
  const html = `
    <div style="
      background-color: #e11d48;
      width: 24px;
      height: 24px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <span style="transform: rotate(45deg); color: white; font-size: 12px; line-height: 1;">🏥</span>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-medical-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
  });
}

function createToiletIcon() {
  const html = `
    <div style="
      background-color: #4f46e5;
      width: 24px;
      height: 24px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <span style="transform: rotate(45deg); color: white; font-size: 12px; line-height: 1;">🚻</span>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-toilet-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
  });
}

function createParkIcon() {
  const html = `
    <div style="
      background-color: #059669;
      width: 22px;
      height: 22px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <span style="transform: rotate(45deg); color: white; font-size: 11px; line-height: 1;">🌳</span>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-park-icon',
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -22],
  });
}

// 地図の初期化
function initMap() {
  const map = L.map('map', {
    center: OYAMA_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
  });

  // ベースレイヤー（国土地理院）
  const gsiStd = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
  });

  const gsiPale = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
  });

  const gsiPhoto = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg', {
    maxZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院 (オルソ)</a>',
  });

  gsiStd.addTo(map);

  // ハザードマップ（国土地理院 洪水浸水想定区域 想定最大規模）
  const hazardFlood = L.tileLayer(
    'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png',
    {
      opacity: 0.7,
      maxZoom: 17,
      minZoom: 2,
      attribution: '<a href="https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html" target="_blank">国交省ハザードマップポータル</a>',
    }
  );
  hazardFlood.addTo(map);

  // レイヤーグループ初期化
  state.sheltersLayerGroup = L.layerGroup().addTo(map);
  state.aedLayerGroup = L.layerGroup();      // 初期非表示
  state.medicalLayerGroup = L.layerGroup();  // 初期非表示
  state.toiletsLayerGroup = L.layerGroup();  // 初期非表示
  state.parksLayerGroup = L.layerGroup();    // 初期非表示

  // レイヤーコントロール
  const baseMaps = {
    '地理院地図 (標準)': gsiStd,
    '淡色地図': gsiPale,
    '航空写真 (オルソ)': gsiPhoto,
  };

  const overlayMaps = {
    '洪水浸水想定区域': hazardFlood,
    '避難所 (74箇所)': state.sheltersLayerGroup,
    '⚡ AED設置場所 (176箇所)': state.aedLayerGroup,
    '🏥 医療機関 (138箇所)': state.medicalLayerGroup,
    '🚻 公衆トイレ (115箇所)': state.toiletsLayerGroup,
    '🌳 公園施設 (351箇所)': state.parksLayerGroup,
  };

  L.control.layers(baseMaps, overlayMaps, { position: 'topright' }).addTo(map);

  state.map = map;
  state.hazardFloodLayer = hazardFlood;

  // レイヤー追加/削除時にフィルターチップのアクティブ状態を同期
  map.on('overlayadd', (e) => syncChipState(e.name, true));
  map.on('overlayremove', (e) => syncChipState(e.name, false));
}

function syncChipState(layerName, isActive) {
  if (layerName.includes('AED')) {
    document.getElementById('toggle-aed')?.classList.toggle('active', isActive);
  } else if (layerName.includes('医療機関')) {
    document.getElementById('toggle-medical')?.classList.toggle('active', isActive);
  } else if (layerName.includes('公衆トイレ') || layerName.includes('トイレ')) {
    document.getElementById('toggle-toilets')?.classList.toggle('active', isActive);
  } else if (layerName.includes('公園')) {
    document.getElementById('toggle-parks')?.classList.toggle('active', isActive);
  }
}

// 全オープンデータのロード
async function loadAllData() {
  try {
    const [sheltersRes, aedRes, medRes, toiletsRes, parksRes] = await Promise.all([
      fetch('./data/shelters.geojson'),
      fetch('./data/aed.geojson'),
      fetch('./data/medical.geojson'),
      fetch('./data/toilets.geojson'),
      fetch('./data/parks.geojson'),
    ]);

    if (!sheltersRes.ok) throw new Error('避難所データの取得に失敗');

    const [sheltersData, aedData, medData, toiletsData, parksData] = await Promise.all([
      sheltersRes.json(),
      aedRes.ok ? aedRes.json() : { features: [] },
      medRes.ok ? medRes.json() : { features: [] },
      toiletsRes.ok ? toiletsRes.json() : { features: [] },
      parksRes.ok ? parksRes.json() : { features: [] },
    ]);

    state.allShelters = sheltersData.features;
    state.allAed = aedData.features;
    state.allMedical = medData.features;
    state.allToilets = toiletsData.features;
    state.allParks = parksData.features;

    updateCounts();
    renderShelters();
    renderAed();
    renderMedical();
    renderToilets();
    renderParks();
  } catch (error) {
    console.error('Error loading data:', error);
    alert('オープンデータの読み込みに失敗しました。');
  }
}

// 施設数カウントの更新
function updateCounts() {
  const counts = {
    all: state.allShelters.length,
    flood: 0,
    earthquake: 0,
    landslide: 0,
    fire: 0,
    inland_flood: 0,
  };

  state.allShelters.forEach((feature) => {
    const d = feature.properties.disasters || {};
    if (d.flood) counts.flood++;
    if (d.earthquake) counts.earthquake++;
    if (d.landslide) counts.landslide++;
    if (d.fire) counts.fire++;
    if (d.inland_flood) counts.inland_flood++;
  });

  Object.keys(counts).forEach((key) => {
    const el = document.getElementById(`count-${key}`);
    if (el) el.textContent = counts[key];
  });

  const aedCountEl = document.getElementById('count-aed');
  if (aedCountEl) aedCountEl.textContent = state.allAed.length;

  const medCountEl = document.getElementById('count-medical');
  if (medCountEl) medCountEl.textContent = state.allMedical.length;

  const toiletsCountEl = document.getElementById('count-toilets');
  if (toiletsCountEl) toiletsCountEl.textContent = state.allToilets.length;

  const parksCountEl = document.getElementById('count-parks');
  if (parksCountEl) parksCountEl.textContent = state.allParks.length;
}

// 避難所の描画
function renderShelters() {
  state.sheltersLayerGroup.clearLayers();
  state.shelterMarkerMap.clear();

  const filter = state.currentFilter;
  const filtered = state.allShelters.filter((feature) => {
    if (filter === 'all') return true;
    return !!(feature.properties.disasters && feature.properties.disasters[filter]);
  });

  filtered.forEach((feature) => {
    const coords = feature.geometry.coordinates;
    const latLng = [coords[1], coords[0]];
    const props = feature.properties;
    const isFloodSafe = !!(props.disasters && props.disasters.flood);

    const marker = L.marker(latLng, {
      icon: createShelterIcon(isFloodSafe),
      title: props.name,
    });

    const popupContent = createShelterPopupHtml(feature);
    marker.bindPopup(popupContent, { maxWidth: 320 });

    state.sheltersLayerGroup.addLayer(marker);
    state.shelterMarkerMap.set(feature.id, marker);
  });
}

// 案B: AED設置場所の描画（176施設）
function renderAed() {
  state.aedLayerGroup.clearLayers();
  state.allAed.forEach((feature) => {
    const coords = feature.geometry.coordinates;
    const latLng = [coords[1], coords[0]];
    const props = feature.properties;

    const marker = L.marker(latLng, {
      icon: createAedIcon(),
      title: props.name,
    });

    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latLng[0]},${latLng[1]}`;
    const popupHtml = `
      <div class="shelter-popup">
        <div style="background: #d97706; color: white; font-weight: 700; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 4px;">⚡ AED設置場所</div>
        <h3>${props.name}</h3>
        <p class="popup-address">📍 ${props.address}</p>
        ${props.location ? `<p style="font-size: 12px; color: #b45309; font-weight: 700; margin-bottom: 4px;">🎯 設置位置: ${props.location}</p>` : ''}
        ${props.available_time ? `<p style="font-size: 11px; color: #475569; margin-bottom: 4px;">⏰ 利用可能時間: ${props.available_time}</p>` : ''}
        ${props.has_pediatric ? `<span class="badge" style="background:#fef3c7; color:#92400e; padding:2px 6px; font-weight:700;">👶 小児対応設備あり</span>` : ''}
        ${props.remarks ? `<p style="font-size: 11px; color: #64748b; margin-top: 4px; margin-bottom: 8px;">備考: ${props.remarks}</p>` : ''}
        <div class="popup-actions" style="margin-top: 8px;">
          <a href="${gmapsUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="width: 100%; text-align: center; background: #d97706;">
            ここへ行く（Googleマップ） ↗
          </a>
        </div>
      </div>
    `;
    marker.bindPopup(popupHtml, { maxWidth: 290 });
    state.aedLayerGroup.addLayer(marker);
  });
}

// 医療機関の描画
function renderMedical() {
  state.medicalLayerGroup.clearLayers();
  state.allMedical.forEach((feature) => {
    const coords = feature.geometry.coordinates;
    const latLng = [coords[1], coords[0]];
    const props = feature.properties;

    const marker = L.marker(latLng, {
      icon: createMedicalIcon(),
      title: props.name,
    });

    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latLng[0]},${latLng[1]}`;
    const popupHtml = `
      <div class="shelter-popup">
        <div style="background: #e11d48; color: white; font-weight: 700; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 4px;">🏥 ${props.type || '医療機関'}</div>
        <h3>${props.name}</h3>
        <p class="popup-address">📍 ${props.address}</p>
        ${props.phone ? `<p style="font-size: 12px; margin-bottom: 4px;">📞 <a href="tel:${props.phone}">${props.phone}</a></p>` : ''}
        ${props.departments ? `<p style="font-size: 11px; color: #475569; margin-bottom: 4px;"><strong>診療科目:</strong> ${props.departments}</p>` : ''}
        ${props.beds ? `<p style="font-size: 11px; color: #64748b; margin-bottom: 8px;">病床数: ${props.beds}床</p>` : ''}
        <div class="popup-actions">
          <a href="${gmapsUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="width: 100%; text-align: center; background: #e11d48;">
            道順を見る ↗
          </a>
        </div>
      </div>
    `;
    marker.bindPopup(popupHtml, { maxWidth: 280 });
    state.medicalLayerGroup.addLayer(marker);
  });
}

// 公衆トイレの描画
function renderToilets() {
  state.toiletsLayerGroup.clearLayers();
  state.allToilets.forEach((feature) => {
    const coords = feature.geometry.coordinates;
    const latLng = [coords[1], coords[0]];
    const props = feature.properties;

    const marker = L.marker(latLng, {
      icon: createToiletIcon(),
      title: props.name,
    });

    const badges = [];
    if (props.has_wheelchair) badges.push('<span class="disaster-tag supported">♿ 車椅子対応</span>');
    if (props.has_baby) badges.push('<span class="disaster-tag supported">👶 乳幼児設備</span>');
    if (props.has_ostomate) badges.push('<span class="disaster-tag supported">🚾 オストメイト</span>');
    if (props.multi_count) badges.push(`<span class="disaster-tag supported">多機能 ${props.multi_count}室</span>`);

    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latLng[0]},${latLng[1]}`;
    const popupHtml = `
      <div class="shelter-popup">
        <div style="background: #4f46e5; color: white; font-weight: 700; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 4px;">🚻 公衆トイレ</div>
        <h3>${props.name}</h3>
        <p class="popup-address">📍 ${props.address}</p>
        <div class="disaster-badge-container" style="margin-top: 6px; margin-bottom: 8px;">
          ${badges.length > 0 ? badges.join('') : '<span style="font-size:11px; color:#64748b;">一般トイレ</span>'}
        </div>
        <div class="popup-actions">
          <a href="${gmapsUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="width: 100%; text-align: center; background: #4f46e5;">
            道順を見る ↗
          </a>
        </div>
      </div>
    `;
    marker.bindPopup(popupHtml, { maxWidth: 280 });
    state.toiletsLayerGroup.addLayer(marker);
  });
}

// 公園施設の描画
function renderParks() {
  state.parksLayerGroup.clearLayers();
  state.allParks.forEach((feature) => {
    const coords = feature.geometry.coordinates;
    const latLng = [coords[1], coords[0]];
    const props = feature.properties;

    const marker = L.marker(latLng, {
      icon: createParkIcon(),
      title: props.name,
    });

    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latLng[0]},${latLng[1]}`;
    const popupHtml = `
      <div class="shelter-popup">
        <div style="background: #059669; color: white; font-weight: 700; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 4px;">🌳 都市公園・待避場所</div>
        <h3>${props.name}</h3>
        <p class="popup-address">📍 ${props.address}</p>
        ${props.area ? `<p style="font-size: 11px; color: #475569; margin-bottom: 6px;">公簿面積: <strong>${Number(props.area).toLocaleString()} ㎡</strong></p>` : ''}
        <div class="popup-actions">
          <a href="${gmapsUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="width: 100%; text-align: center; background: #059669;">
            道順を見る ↗
          </a>
        </div>
      </div>
    `;
    marker.bindPopup(popupHtml, { maxWidth: 280 });
    state.parksLayerGroup.addLayer(marker);
  });
}

// 避難所ポップアップHTML生成（案A: AED常設/最寄り情報含むクロス集計付き）
function createShelterPopupHtml(feature, isHighlight = false) {
  const props = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;

  let disasterTags = '';
  for (const [key, info] of Object.entries(DISASTER_INFO)) {
    const isOk = props.disasters && props.disasters[key];
    const statusClass = isOk ? 'supported' : 'unsupported';
    const mark = isOk ? '◯' : '×';
    disasterTags += `<span class="disaster-tag ${statusClass}">${info.name} ${mark}</span>`;
  }

  // Googleマップ経路リンク
  let gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  let distanceHtml = '';

  if (state.userLocation) {
    const from = turf.point(state.userLocation);
    const to = turf.point([lon, lat]);
    const distanceKm = turf.distance(from, to, { units: 'kilometers' });
    const distMeters = Math.round(distanceKm * 1000);
    const walkMinutes = Math.max(1, Math.round(distMeters / 80));

    gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${state.userLocation[1]},${state.userLocation[0]}&destination=${lat},${lon}`;
    
    distanceHtml = `
      <div style="background: #e0f2fe; padding: 6px 10px; border-radius: 6px; margin: 6px 0; font-size: 12px; color: #0369a1; font-weight: 700;">
        📍 現在地から: 約 ${distMeters < 1000 ? `${distMeters} m` : `${(distMeters / 1000).toFixed(1)} km`}（徒歩約 ${walkMinutes} 分）
      </div>
    `;
  }

  const highlightHeader = isHighlight
    ? `<div style="background: #ea580c; color: white; font-weight: 700; font-size: 11px; padding: 3px 8px; border-radius: 4px; display: inline-block; margin-bottom: 6px;">🎯 条件に合致する最寄り避難所</div>`
    : '';

  // 案A: クロス集計情報（AED・医療・トイレ・公園）
  let crossHtml = '';
  const cross = props.cross_analysis;
  if (cross) {
    const aed = cross.aed;
    const med = cross.nearest_medical;
    const toilet = cross.nearby_toilet;
    const park = cross.nearest_park;

    let toiletBadges = '';
    if (toilet && toilet.has_wheelchair) toiletBadges += '<span class="badge">♿車椅子</span>';
    if (toilet && toilet.has_baby) toiletBadges += '<span class="badge">👶乳幼児</span>';
    if (toilet && toilet.has_ostomate) toiletBadges += '<span class="badge">🚾オストメイト</span>';

    let aedLine = '';
    if (aed) {
      if (aed.has_inside) {
        aedLine = `
          <div class="cross-item" style="color: #b45309; font-weight: 700;">
            ⚡ <strong>AED設置: 施設内に常設あり</strong> ${aed.has_pediatric ? '<span class="badge" style="background:#fef3c7; color:#92400e;">👶小児対応</span>' : ''}<br />
            &nbsp;&nbsp;&nbsp;設置場所: ${aed.inside_location || '施設内・受付'}
          </div>
        `;
      } else if (aed.nearest_name) {
        aedLine = `
          <div class="cross-item">
            ⚡ <strong>最寄りのAED:</strong> ${aed.nearest_name}<br />
            &nbsp;&nbsp;&nbsp;直線 約${aed.nearest_distance_m}m (徒歩約${aed.nearest_walk_min}分) ${aed.nearest_location ? `[${aed.nearest_location}]` : ''}
          </div>
        `;
      }
    }

    crossHtml = `
      <div class="cross-analysis-box">
        <div class="cross-title">📊 周辺インフラ（クロス集計情報）</div>
        ${aedLine}
        ${med ? `
          <div class="cross-item">
            🏥 <strong>最寄りの医療機関:</strong> ${med.name} (${med.type})<br />
            &nbsp;&nbsp;&nbsp;直線 約${med.distance_m < 1000 ? `${med.distance_m}m` : `${(med.distance_m/1000).toFixed(1)}km`} (徒歩${med.walk_min}分) ${med.phone ? `📞 ${med.phone}` : ''}
          </div>
        ` : ''}
        ${toilet && toilet.nearest_name ? `
          <div class="cross-item">
            🚻 <strong>近隣の公衆トイレ:</strong> ${toilet.nearest_name} ${toiletBadges}<br />
            &nbsp;&nbsp;&nbsp;直線 約${toilet.distance_m}m (徒歩${toilet.walk_min}分)
          </div>
        ` : ''}
        ${park ? `
          <div class="cross-item">
            🌳 <strong>近隣待避公園:</strong> ${park.name} ${park.area ? `(${Number(park.area).toLocaleString()}㎡)` : ''}<br />
            &nbsp;&nbsp;&nbsp;直線 約${park.distance_m}m (徒歩${park.walk_min}分)
          </div>
        ` : ''}
      </div>
    `;
  }

  return `
    <div class="shelter-popup">
      ${highlightHeader}
      <h3>${props.name}</h3>
      <p class="popup-address">📍 ${props.address}</p>
      ${distanceHtml}
      <div style="font-size: 11px; font-weight: bold; margin-bottom: 4px; color: #475569;">対応災害一覧:</div>
      <div class="disaster-badge-container">
        ${disasterTags}
      </div>
      ${crossHtml}
      ${props.remarks ? `<p style="font-size: 11px; color: #64748b; margin-bottom: 8px;">備考: ${props.remarks}</p>` : ''}
      <div class="popup-actions">
        <a href="${gmapsUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="width: 100%; text-align: center;">
          Googleマップで道順を見る ↗
        </a>
      </div>
    </div>
  `;
}

// ユーザーの現在地マーカーを描画する
function setUserLocationMarker(lat, lon, label = '📍 あなたの現在地') {
  state.userLocation = [lon, lat];

  if (state.currentLocationMarker) {
    state.map.removeLayer(state.currentLocationMarker);
  }

  const userIcon = L.divIcon({
    html: `<div style="
      width: 20px;
      height: 20px;
      background-color: #2563eb;
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 0 12px rgba(37, 99, 235, 0.9);
    "></div>`,
    className: 'user-location-icon',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  state.currentLocationMarker = L.marker([lat, lon], { icon: userIcon }).addTo(state.map);
  state.currentLocationMarker.bindTooltip(label, { permanent: true, direction: 'top' });
}

// ユーザーの現在地を取得する関数
function acquireUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('お使いのブラウザは位置情報取得に対応していません。'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocationMarker(pos.coords.latitude, pos.coords.longitude, '📍 現在地');
        resolve(state.userLocation);
      },
      (err) => {
        console.warn('Geolocation fast pass warning:', err.message);
        navigator.geolocation.getCurrentPosition(
          (posHigh) => {
            setUserLocationMarker(posHigh.coords.latitude, posHigh.coords.longitude, '📍 現在地');
            resolve(state.userLocation);
          },
          (errHigh) => reject(errHigh),
          { enableHighAccuracy: true, timeout: 6000 }
        );
      },
      { enableHighAccuracy: false, timeout: 6000 }
    );
  });
}

// 条件に合致する最寄り避難所を検索し、ハイライト表示する
function findAndHighlightNearestShelter(shouldFitBounds = true) {
  if (!state.userLocation) return null;

  const [userLon, userLat] = state.userLocation;
  const userPoint = turf.point([userLon, userLat]);
  const filter = state.currentFilter;

  const candidates = state.allShelters.filter((f) => {
    if (filter === 'all') return true;
    return !!(f.properties.disasters && f.properties.disasters[filter]);
  });

  if (candidates.length === 0) {
    const filterName = DISASTER_INFO[filter]?.name || filter;
    alert(`選択中の条件（${filterName}）に合致する避難所が見つかりません。`);
    return null;
  }

  let nearestFeature = null;
  let minDistance = Infinity;

  candidates.forEach((feature) => {
    const shelterPoint = turf.point(feature.geometry.coordinates);
    const distance = turf.distance(userPoint, shelterPoint, { units: 'kilometers' });
    if (distance < minDistance) {
      minDistance = distance;
      nearestFeature = feature;
    }
  });

  if (!nearestFeature) return null;

  const nearestCoords = nearestFeature.geometry.coordinates;
  const nearestLatLng = [nearestCoords[1], nearestCoords[0]];
  const distMeters = Math.round(minDistance * 1000);
  const walkMinutes = Math.max(1, Math.round(distMeters / 80));

  if (state.highlightMarker) {
    state.map.removeLayer(state.highlightMarker);
    state.highlightMarker = null;
  }

  state.highlightMarker = L.marker(nearestLatLng, {
    icon: createHighlightShelterIcon(),
    zIndexOffset: 1200,
  }).addTo(state.map);

  const popupHtml = createShelterPopupHtml(nearestFeature, true);
  state.highlightMarker.bindPopup(popupHtml, { maxWidth: 320 }).openPopup();

  if (state.nearestLine) {
    state.map.removeLayer(state.nearestLine);
  }

  state.nearestLine = L.polyline(
    [
      [userLat, userLon],
      nearestLatLng,
    ],
    {
      color: '#ea580c',
      weight: 4,
      dashArray: '8, 8',
      opacity: 0.9,
    }
  ).addTo(state.map);

  const filterLabel = filter === 'all' ? '全体' : DISASTER_INFO[filter]?.name;
  const card = document.getElementById('nearest-card');
  const nameEl = document.getElementById('nearest-name');
  const distEl = document.getElementById('nearest-distance');
  const walkEl = document.getElementById('nearest-walk');
  const gmapsLink = document.getElementById('link-gmaps-nearest');
  const btnFocus = document.getElementById('btn-focus-nearest');

  nameEl.textContent = `【${filterLabel}対応】${nearestFeature.properties.name}`;
  distEl.textContent = distMeters < 1000 ? `直線距離: 約 ${distMeters} m` : `直線距離: 約 ${(distMeters / 1000).toFixed(1)} km`;
  walkEl.textContent = `徒歩目安: 約 ${walkMinutes} 分`;
  gmapsLink.href = `https://www.google.com/maps/dir/?api=1&origin=${userLat},${userLon}&destination=${nearestLatLng[0]},${nearestLatLng[1]}`;

  card.classList.remove('hidden');

  btnFocus.onclick = () => {
    state.map.setView(nearestLatLng, 16);
    state.highlightMarker.openPopup();
  };

  if (shouldFitBounds) {
    if (minDistance > 25) {
      state.map.setView(nearestLatLng, 15);
    } else {
      const bounds = L.latLngBounds([
        [userLat, userLon],
        nearestLatLng,
      ]);
      state.map.fitBounds(bounds, { padding: [90, 90], maxZoom: 16 });
    }
  }

  return nearestFeature;
}

// 「最寄りの避難所」ボタンのセットアップ
function setupNearestButton() {
  const btnNearest = document.getElementById('btn-nearest');

  btnNearest.addEventListener('click', async () => {
    btnNearest.classList.add('loading');
    const btnText = btnNearest.querySelector('.btn-text');
    btnText.textContent = '検索中...';

    try {
      if (!state.userLocation) {
        try {
          await acquireUserLocation();
        } catch (geoErr) {
          console.warn('Geolocation failed:', geoErr);
          const useFallback = confirm(
            '現在地を取得できませんでした。\n小山市役所を基準地点として最寄りの避難所を検索しますか？'
          );
          if (useFallback) {
            setUserLocationMarker(OYAMA_CENTER[0], OYAMA_CENTER[1], '📍 基準地（小山市役所）');
          } else {
            return;
          }
        }
      }

      findAndHighlightNearestShelter(true);
    } catch (err) {
      console.error('Nearest search error:', err);
      alert('最寄り避難所の検索中にエラーが発生しました。');
    } finally {
      btnNearest.classList.remove('loading');
      btnText.textContent = '最寄りの避難所';
    }
  });
}

// 「現在地」ボタンのセットアップ
function setupGeolocation() {
  const btnLocate = document.getElementById('btn-locate');

  btnLocate.addEventListener('click', async () => {
    btnLocate.classList.add('loading');
    const btnText = btnLocate.querySelector('.btn-text');
    btnText.textContent = '測位中...';

    try {
      await acquireUserLocation();
      state.map.setView([state.userLocation[1], state.userLocation[0]], 15);
      if (state.highlightMarker) {
        findAndHighlightNearestShelter(false);
      }
    } catch (err) {
      console.warn('Geolocation error:', err);
      alert('現在地を取得できませんでした。ブラウザの位置情報の利用を許可してください。');
    } finally {
      btnLocate.classList.remove('loading');
      btnText.textContent = '現在地';
    }
  });
}

// フィルターチップ＆施設レイヤートグルのセットアップ
function setupFilterChips() {
  // 避難所フィルター
  const shelterChips = document.querySelectorAll('.filter-chip:not(.chip-toggle)');
  shelterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      shelterChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');

      state.currentFilter = chip.dataset.filter;
      renderShelters();

      if (state.userLocation) {
        findAndHighlightNearestShelter(true);
      }
    });
  });

  // 周辺施設トグルボタン（AED、医療機関、公衆トイレ、公園）
  const toggleChips = document.querySelectorAll('.filter-chip.chip-toggle');
  toggleChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const target = chip.dataset.targetLayer;
      let targetGroup = null;

      if (target === 'aed') targetGroup = state.aedLayerGroup;
      if (target === 'medical') targetGroup = state.medicalLayerGroup;
      if (target === 'toilets') targetGroup = state.toiletsLayerGroup;
      if (target === 'parks') targetGroup = state.parksLayerGroup;

      if (!targetGroup) return;

      if (state.map.hasLayer(targetGroup)) {
        state.map.removeLayer(targetGroup);
        chip.classList.remove('active');
      } else {
        state.map.addLayer(targetGroup);
        chip.classList.add('active');
      }
    });
  });
}

// ハザード操作コントロール
function setupHazardControls() {
  const chkFlood = document.getElementById('chk-hazard-flood');
  const slider = document.getElementById('hazard-opacity');
  const opacityVal = document.getElementById('opacity-val');
  const sliderContainer = document.getElementById('hazard-slider-container');

  chkFlood.addEventListener('change', (e) => {
    if (e.target.checked) {
      state.hazardFloodLayer.addTo(state.map);
      sliderContainer.style.display = 'flex';
    } else {
      state.map.removeLayer(state.hazardFloodLayer);
      sliderContainer.style.display = 'none';
    }
  });

  slider.addEventListener('input', (e) => {
    const val = Number(e.target.value) / 100;
    state.hazardFloodLayer.setOpacity(val);
    opacityVal.textContent = `${e.target.value}%`;
  });
}

// 情報モーダルのセットアップ
function setupModal() {
  const btnInfo = document.getElementById('btn-info');
  const modal = document.getElementById('info-modal');
  const btnClose = document.getElementById('modal-close');

  btnInfo.addEventListener('click', () => modal.classList.remove('hidden'));
  btnClose.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

// メイン初期化
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupHazardControls();
  setupNearestButton();
  setupGeolocation();
  setupFilterChips();
  setupModal();
  loadAllData();
});
