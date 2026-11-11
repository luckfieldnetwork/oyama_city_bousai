# さくらのレンタルサーバへのデプロイ手順書

本アプリケーションは「Jamstack型 Web GIS」構成を採用しているため、さくらのレンタルサーバ側での Python や DB（SpatiaLite）の複雑なビルド・常駐プロセスの設定は一切不要です。
ビルド後の静的ファイルを所定のディレクトリに配置するだけで、最もセキュアかつ高速に稼働します。

---

## 1. ビルドの実行

ローカル（Windows 11 Docker環境またはホスト）で最新データを取得し、フロントエンドをビルドします。

```bash
# 1. 避難所オープンデータの最新化（必要時）
python data_pipeline/fetch_shelters.py
# (または Docker: docker compose run data-pipeline)

# 2. 静的ファイルのビルド
cd frontend
npm run build
```

実行後、`frontend/dist/` ディレクトリ配下に以下の成果物が生成されます。
- `index.html`
- `assets/` (JS, CSS)
- `data/shelters.geojson` (小山市の避難所データ)
- `.htaccess` (キャッシュ・MIMEタイプ設定)

---

## 2. さくらのレンタルサーバへのアップロード

生成された `frontend/dist/` の中身を、さくらのレンタルサーバの公開領域（ドキュメントルート）にアップロードします。

### アップロード先の例
- **ドメイン直下に公開する場合**:
  `~/www/`
- **サブディレクトリで公開する場合（例: `https://example.sakura.ne.jp/oyama-bousai/`）**:
  `~/www/oyama-bousai/`

### アップロード方法

#### 方法A: ファイルマネージャー（ブラウザ操作）
1. さくらのレンタルサーバ コントロールパネルにログイン
2. 「ファイルマネージャー」を開く
3. 対象フォルダ（`~/www/` 等）へ移動
4. `frontend/dist/` 配下の全ファイル・フォルダをドラッグ＆ドロップでアップロード

#### 方法B: SCP / SFTP / rsync（コマンドライン）
SSHが有効な場合、以下のコマンドで一括同期できます：

```bash
# 例: rsyncで同期する場合 (sakura-user と host は自身のアカウント情報に置換)
rsync -avz --delete frontend/dist/ sakura-user@sakura-user.sakura.ne.jp:www/oyama-bousai/
```

#### 方法C: GitHub Actions（自動デプロイ）
GitHubリポジトリにプッシュした際、FTP/SFTP Action を使って自動デプロイすることも可能です。

---

## 3. 動作確認

ブラウザで公開URL（例: `https://<あなたのドメイン>/oyama-bousai/`）にアクセスし、以下を確認します。
- [x] 小山市の地図（国土地理院地図）が表示されるか
- [x] 洪水浸水想定区域（思川、巴波川等）が半透明でオーバーレイ表示されるか
- [x] 74箇所の避難所ピンが表示され、タップ時に詳細情報が出るか
- [x] 災害種別フィルター（洪水、地震、土砂災害等）でピンが正しく絞り込めるか
- [x] 「現在地」ボタンを押して最寄り避難所への距離・ルートが計算されるか
