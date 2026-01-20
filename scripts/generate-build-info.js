import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.resolve(__dirname, '../public');
const filePath = path.join(publicDir, 'build.json');

// Ensure public dir exists
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

let gitSha = 'unknown';
try {
    gitSha = execSync('git rev-parse --short HEAD').toString().trim();
} catch (e) {
    gitSha = process.env.VITE_GIT_SHA || 'dev';
}

const buildInfo = {
    domain_hint: "naborca.netlify.app",
    git_sha: gitSha,
    build_time_iso: new Date().toISOString(),
    features_expected: [
        "NO_sinapi_inputs_requests",
        "modal_add_item_uses_insumos",
        "badges_INS_CPU",
        "handleAddItem_supports_COMPOSITION"
    ]
};

fs.writeFileSync(filePath, JSON.stringify(buildInfo, null, 2));

console.log('[BUILD INFO] Generated public/build.json:', buildInfo);
