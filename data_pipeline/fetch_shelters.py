"""小山市 オープンデータ包括的取得・加工パイプライン

【取得元】
1. 国土地理院ベクトルタイル:
   - 指定緊急避難場所（74施設）
2. Code for OYAMA 公式API (https://api.code4oyama.org/v1.0/)
   - /aed_locations (AED設置場所 176件)
   - /medical_institutions (医療機関 138件)
   - /public_toilets (公衆トイレ 115件)
   - /park_facilities (公園施設 351件)
   ※API取得失敗時は小山市公式HPのCSVダウンロードへ自動フォールバック

【加工】
各避難所に対して「施設内・最寄りAED」「最寄り医療機関」「近隣トイレ」「近隣公園」を
空間クロス集計し、各GeoJSONを出力します。
"""

import csv
import io
import json
import math
import os
import urllib.parse
import urllib.request

# Code for OYAMA API ベースURL
API_BASE = "https://api.code4oyama.org/v1.0"

# 小山市公式オープンデータ ダウンロードURL (フォールバック用)
OYAMA_DL_URL = "https://www.city.oyama.tochigi.jp/opendata_download.php?code="
FALLBACK_CODES = {
    "medical": 508,
    "toilets": 482,
    "parks": 634,
}
FALLBACK_AED_URL = "https://raw.githubusercontent.com/code4oyama/oyama_aed_map/main/" + urllib.parse.quote("AED設置場所_小山市オープンデータ_UTF-8_BOM無.csv")

# 災害種別定義
DISASTER_TYPES = {
    "flood": {"code": "skhb01", "name_ja": "洪水"},
    "landslide": {"code": "skhb02", "name_ja": "土砂災害"},
    "surge": {"code": "skhb03", "name_ja": "高潮"},
    "earthquake": {"code": "skhb04", "name_ja": "地震"},
    "tsunami": {"code": "skhb05", "name_ja": "津波"},
    "fire": {"code": "skhb06", "name_ja": "大規模火災"},
    "inland_flood": {"code": "skhb07", "name_ja": "内水氾濫"},
    "volcano": {"code": "skhb08", "name_ja": "火山現象"},
}

ZOOM = 10
X_TILES = [908, 909, 910]
Y_TILES = [400, 401, 402]


def fetch_api(endpoint: str, limit: int = 1000):
    """Code for OYAMA API から JSON を取得"""
    url = f"{API_BASE}/{endpoint}?limit={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": "OyamaBousaiApp/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            if res.status == 200:
                return json.loads(res.read().decode("utf-8"))
    except Exception as e:
        print(f"   [API警告] {endpoint} の取得に失敗しました ({e})。フォールバックを試みます。")
    return None


def download_csv_fallback(code: int):
    """小山市HPからCSVを取得 (フォールバック)"""
    url = f"{OYAMA_DL_URL}{code}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as res:
        raw = res.read()
        for enc in ["utf-8-sig", "utf-8", "cp932"]:
            try:
                text = raw.decode(enc)
                reader = csv.DictReader(io.StringIO(text))
                return list(reader)
            except UnicodeDecodeError:
                continue
    return []


def parse_lat_lon(raw_lat, raw_lon):
    """緯度・経度の逆転や異常値を補正"""
    try:
        v1 = float(str(raw_lat).strip())
        v2 = float(str(raw_lon).strip())
        if v1 == 0 or v2 == 0:
            return None, None
        # 日本の経度は 130〜145 付近、緯度は 30〜45 付近
        if v1 > 100 and v2 < 100:
            return v2, v1  # 緯度, 経度
        return v1, v2
    except (ValueError, TypeError):
        return None, None


def haversine_distance(coord1, coord2):
    """2点間の直線距離（メートル）を計算"""
    lon1, lat1 = coord1
    lon2, lat2 = coord2
    r = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def fetch_shelters():
    print("1. 避難所データ収集 (国土地理院ベクトルタイル)...")
    shelters_map = {}

    for disaster_key, info in DISASTER_TYPES.items():
        layer = info["code"]
        for x in X_TILES:
            for y in Y_TILES:
                url = f"https://cyberjapandata.gsi.go.jp/xyz/{layer}/{ZOOM}/{x}/{y}.geojson"
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "OyamaBousaiApp/1.0"})
                    with urllib.request.urlopen(req, timeout=10) as res:
                        if res.status == 200:
                            tile_data = json.loads(res.read().decode("utf-8"))
                            for f in tile_data.get("features", []):
                                props = f.get("properties", {})
                                addr = props.get("address", "")
                                if "栃木県小山市" in addr:
                                    name = props.get("name", "").strip()
                                    coords = f.get("geometry", {}).get("coordinates", [])
                                    if len(coords) < 2:
                                        continue
                                    key = (name, round(coords[0], 5), round(coords[1], 5))
                                    if key not in shelters_map:
                                        shelters_map[key] = {
                                            "id": f"shelter-{len(shelters_map) + 1:03d}",
                                            "name": name,
                                            "address": addr,
                                            "remarks": props.get("remarks", "") or "",
                                            "coordinates": coords,
                                            "disasters": {},
                                        }
                                    shelters_map[key]["disasters"][disaster_key] = True
                except Exception:
                    pass

    print(f"   -> 避難所数: {len(shelters_map)} 件")
    return list(shelters_map.values())


def process_medical():
    print("2. 医療機関データ取得 (Code for OYAMA API)...")
    data = fetch_api("medical_institutions", 500)
    features = []

    if data:
        for idx, item in enumerate(data, start=1):
            lat, lon = parse_lat_lon(item.get("latitude"), item.get("longitude"))
            if not lat or not lon:
                continue
            features.append({
                "type": "Feature",
                "id": f"med-{idx:03d}",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": f"med-{idx:03d}",
                    "name": item.get("name", "").strip(),
                    "type": item.get("category", "").strip(),
                    "address": item.get("address", "").strip(),
                    "departments": item.get("medical_departments", "").strip(),
                    "beds": item.get("bed_count", "").strip(),
                    "phone": item.get("phone_number", "").strip(),
                }
            })
    else:
        # フォールバック
        print("   -> 小山市HP CSVより取得中...")
        rows = download_csv_fallback(FALLBACK_CODES["medical"])
        for idx, r in enumerate(rows, start=1):
            lat, lon = parse_lat_lon(r.get("緯度"), r.get("経度"))
            if not lat or not lon:
                continue
            features.append({
                "type": "Feature",
                "id": f"med-{idx:03d}",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": f"med-{idx:03d}",
                    "name": r.get("名称", "").strip(),
                    "type": r.get("医療機関の種類", "").strip(),
                    "address": r.get("住所", "").strip(),
                    "departments": r.get("診療科目", "").strip(),
                    "beds": r.get("病床数", "").strip(),
                    "phone": r.get("電話番号", "").strip(),
                }
            })

    print(f"   -> 医療機関数: {len(features)} 件")
    return features


def process_toilets():
    print("3. 公衆トイレデータ取得 (Code for OYAMA API)...")
    data = fetch_api("public_toilets", 500)
    features = []

    if data:
        for idx, item in enumerate(data, start=1):
            lat, lon = parse_lat_lon(item.get("latitude"), item.get("longitude"))
            if not lat or not lon:
                continue
            features.append({
                "type": "Feature",
                "id": f"toilet-{idx:03d}",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": f"toilet-{idx:03d}",
                    "name": item.get("name", "").strip(),
                    "address": item.get("address", "").strip(),
                    "has_wheelchair": "有" in str(item.get("車椅子使用者用トイレ有無", "")),
                    "has_baby": "有" in str(item.get("乳幼児用設備設置トイレ有無", "")),
                    "has_ostomate": "有" in str(item.get("オストメイト設置トイレ有無", "")),
                    "multi_count": str(item.get("多機能トイレ数", "")).strip(),
                }
            })
    else:
        print("   -> 小山市HP CSVより取得中...")
        rows = download_csv_fallback(FALLBACK_CODES["toilets"])
        for idx, r in enumerate(rows, start=1):
            lat, lon = parse_lat_lon(r.get("緯度"), r.get("経度"))
            if not lat or not lon:
                continue
            features.append({
                "type": "Feature",
                "id": f"toilet-{idx:03d}",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": f"toilet-{idx:03d}",
                    "name": r.get("名称", "").strip(),
                    "address": r.get("住所", "").strip(),
                    "has_wheelchair": "有" in r.get("車椅子使用者用トイレ有無", ""),
                    "has_baby": "有" in r.get("乳幼児用設備設置トイレ有無", ""),
                    "has_ostomate": "有" in r.get("オストメイト設置トイレ有無", ""),
                    "multi_count": r.get("多機能トイレ数", "").strip(),
                }
            })

    print(f"   -> 公衆トイレ数: {len(features)} 件")
    return features


def process_parks():
    print("4. 公園施設データ取得 (Code for OYAMA API)...")
    data = fetch_api("park_facilities", 1000)
    features = []

    if data:
        for idx, item in enumerate(data, start=1):
            lat, lon = parse_lat_lon(item.get("latitude"), item.get("longitude"))
            if not lat or not lon:
                continue
            features.append({
                "type": "Feature",
                "id": f"park-{idx:03d}",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": f"park-{idx:03d}",
                    "name": item.get("name", "").strip(),
                    "address": item.get("address", "").strip(),
                    "area": str(item.get("registered_area", "")).strip(),
                }
            })
    else:
        print("   -> 小山市HP CSVより取得中...")
        rows = download_csv_fallback(FALLBACK_CODES["parks"])
        for idx, r in enumerate(rows, start=1):
            lat, lon = parse_lat_lon(r.get("緯度"), r.get("経度"))
            if not lat or not lon:
                continue
            features.append({
                "type": "Feature",
                "id": f"park-{idx:03d}",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": f"park-{idx:03d}",
                    "name": r.get("名称", "").strip(),
                    "address": r.get("所在地_連結表記", "").strip(),
                    "area": r.get("公簿面積", "").strip(),
                }
            })

    print(f"   -> 公園施設数: {len(features)} 件")
    return features


def process_aed():
    print("5. AED設置場所データ取得 (Code for OYAMA API)...")
    data = fetch_api("aed_locations", 500)
    features = []

    if data:
        for idx, item in enumerate(data, start=1):
            lat, lon = parse_lat_lon(item.get("latitude"), item.get("longitude"))
            if not lat or not lon:
                continue
            features.append({
                "type": "Feature",
                "id": f"aed-{idx:03d}",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": f"aed-{idx:03d}",
                    "name": item.get("name", "").strip(),
                    "address": item.get("address", "").strip(),
                    "location": item.get("location", "").strip(),
                    "phone": item.get("phone_number", "").strip(),
                    "has_pediatric": "有" in str(item.get("pediatric_equipment_available", "")),
                    "available_time": f"{item.get('start_time', '')}～{item.get('end_time', '')}".strip("～"),
                    "remarks": item.get("available_hours_notes", "") or item.get("remarks", ""),
                }
            })
    else:
        print("   -> GitHub CSVより取得中...")
        req = urllib.request.Request(FALLBACK_AED_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as res:
            text = res.read().decode("utf-8")
            reader = csv.DictReader(io.StringIO(text))
            for idx, r in enumerate(reader, start=1):
                lat, lon = parse_lat_lon(r.get("緯度"), r.get("経度"))
                if not lat or not lon:
                    continue
                features.append({
                    "type": "Feature",
                    "id": f"aed-{idx:03d}",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "id": f"aed-{idx:03d}",
                        "name": r.get("名称", "").strip(),
                        "address": r.get("住所", "").strip(),
                        "location": r.get("設置位置", "").strip(),
                        "phone": r.get("電話番号", "").strip(),
                        "has_pediatric": "有" in r.get("小児対応設備の有無", ""),
                        "available_time": f"{r.get('開始時間', '')}～{r.get('終了時間', '')}".strip("～"),
                        "remarks": r.get("利用可能日時特記事項", "") or r.get("備考", ""),
                    }
                })

    print(f"   -> AED設置箇所数: {len(features)} 件")
    return features


def build_cross_analysis(shelters, medical_list, toilet_list, park_list, aed_list):
    """空間クロス集計（避難所の周辺防災サマリー算出）"""
    print("6. 空間クロス集計実行中...")
    shelter_features = []

    for s in shelters:
        s_coord = s["coordinates"]
        s_name = s["name"]

        # AED判定
        aed_dists = []
        installed_inside = None
        for a in aed_list:
            dist = haversine_distance(s_coord, a["geometry"]["coordinates"])
            aed_props = a["properties"]
            if s_name in aed_props["name"] or aed_props["name"] in s_name or dist <= 60:
                if not installed_inside or dist < installed_inside["dist"]:
                    installed_inside = {
                        "dist": dist,
                        "name": aed_props["name"],
                        "location": aed_props["location"],
                        "has_pediatric": aed_props["has_pediatric"],
                    }
            aed_dists.append((dist, aed_props))

        aed_dists.sort(key=lambda x: x[0])
        aed_summary = {
            "has_inside": installed_inside is not None,
            "inside_location": installed_inside["location"] if installed_inside else "",
            "has_pediatric": installed_inside["has_pediatric"] if installed_inside else False,
            "nearest_name": aed_dists[0][1]["name"] if aed_dists else "",
            "nearest_distance_m": round(aed_dists[0][0]) if aed_dists else 0,
            "nearest_walk_min": max(1, round(aed_dists[0][0] / 80)) if aed_dists else 0,
            "nearest_location": aed_dists[0][1]["location"] if aed_dists else "",
        }

        # 最寄り医療機関
        med_dists = []
        for m in medical_list:
            dist = haversine_distance(s_coord, m["geometry"]["coordinates"])
            med_dists.append((dist, m["properties"]))
        med_dists.sort(key=lambda x: x[0])
        nearest_med = None
        if med_dists:
            nearest_med = {
                "name": med_dists[0][1]["name"],
                "type": med_dists[0][1]["type"],
                "distance_m": round(med_dists[0][0]),
                "walk_min": max(1, round(med_dists[0][0] / 80)),
                "phone": med_dists[0][1]["phone"],
            }

        # 近隣トイレ
        toilet_dists = []
        for t in toilet_list:
            dist = haversine_distance(s_coord, t["geometry"]["coordinates"])
            toilet_dists.append((dist, t["properties"]))
        toilet_dists.sort(key=lambda x: x[0])
        nearby_toilets_summary = None
        if toilet_dists:
            top_t = toilet_dists[0]
            nearby_toilets_summary = {
                "has_nearby": top_t[0] <= 1000,
                "nearest_name": top_t[1]["name"],
                "distance_m": round(top_t[0]),
                "walk_min": max(1, round(top_t[0] / 80)),
                "has_wheelchair": top_t[1]["has_wheelchair"],
                "has_baby": top_t[1]["has_baby"],
                "has_ostomate": top_t[1]["has_ostomate"],
            }

        # 最寄り公園
        park_dists = []
        for p in park_list:
            dist = haversine_distance(s_coord, p["geometry"]["coordinates"])
            park_dists.append((dist, p["properties"]))
        park_dists.sort(key=lambda x: x[0])
        nearest_park = None
        if park_dists:
            top_p = park_dists[0]
            nearest_park = {
                "name": top_p[1]["name"],
                "distance_m": round(top_p[0]),
                "walk_min": max(1, round(top_p[0] / 80)),
                "area": top_p[1]["area"],
            }

        shelter_features.append({
            "type": "Feature",
            "id": s["id"],
            "geometry": {"type": "Point", "coordinates": s_coord},
            "properties": {
                "id": s["id"],
                "name": s["name"],
                "address": s["address"],
                "remarks": s["remarks"],
                "disasters": s["disasters"],
                "disaster_count": len(s["disasters"]),
                "cross_analysis": {
                    "aed": aed_summary,
                    "nearest_medical": nearest_med,
                    "nearby_toilet": nearby_toilets_summary,
                    "nearest_park": nearest_park,
                }
            }
        })

    return shelter_features


def main():
    print("=== 小山市 包括的オープンデータ構築パイプライン開始 ===")
    
    output_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "frontend", "public", "data"
    )
    os.makedirs(output_dir, exist_ok=True)

    # 1. 各データ取得 (Code for OYAMA API & 国土地理院)
    shelters = fetch_shelters()
    medical_features = process_medical()
    toilet_features = process_toilets()
    park_features = process_parks()
    aed_features = process_aed()

    # 2. クロス集計
    shelter_features = build_cross_analysis(shelters, medical_features, toilet_features, park_features, aed_features)

    # 3. 各GeoJSONファイル出力
    with open(os.path.join(output_dir, "shelters.geojson"), "w", encoding="utf-8") as f:
        json.dump({
            "type": "FeatureCollection",
            "metadata": {
                "title": "栃木県小山市 指定緊急避難場所データ（周辺クロス集計付き）",
                "author": "栃木県小山市",
                "source": "Code for OYAMA API / 国土地理院オープンデータ基盤",
                "count": len(shelter_features),
            },
            "features": shelter_features
        }, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, "aed.geojson"), "w", encoding="utf-8") as f:
        json.dump({
            "type": "FeatureCollection",
            "metadata": {
                "title": "栃木県小山市 AED設置場所一覧",
                "author": "栃木県小山市",
                "source": "Code for OYAMA API (/aed_locations)",
                "count": len(aed_features),
            },
            "features": aed_features
        }, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, "medical.geojson"), "w", encoding="utf-8") as f:
        json.dump({
            "type": "FeatureCollection",
            "metadata": {
                "title": "栃木県小山市 医療機関一覧",
                "author": "栃木県小山市",
                "source": "Code for OYAMA API (/medical_institutions)",
                "count": len(medical_features),
            },
            "features": medical_features
        }, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, "toilets.geojson"), "w", encoding="utf-8") as f:
        json.dump({
            "type": "FeatureCollection",
            "metadata": {
                "title": "栃木県小山市 公衆トイレ一覧",
                "author": "栃木県小山市",
                "source": "Code for OYAMA API (/public_toilets)",
                "count": len(toilet_features),
            },
            "features": toilet_features
        }, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, "parks.geojson"), "w", encoding="utf-8") as f:
        json.dump({
            "type": "FeatureCollection",
            "metadata": {
                "title": "栃木県小山市 公園施設一覧",
                "author": "栃木県小山市",
                "source": "Code for OYAMA API (/park_facilities)",
                "count": len(park_features),
            },
            "features": park_features
        }, f, ensure_ascii=False, indent=2)

    print("\n✅ 全オープンデータのGeoJSON出力および空間クロス集計が完了しました！")
    print(f"   - shelters.geojson: {len(shelter_features)} 件")
    print(f"   - aed.geojson:      {len(aed_features)} 件")
    print(f"   - medical.geojson:  {len(medical_features)} 件")
    print(f"   - toilets.geojson:  {len(toilet_features)} 件")
    print(f"   - parks.geojson:    {len(park_features)} 件")


if __name__ == "__main__":
    main()
