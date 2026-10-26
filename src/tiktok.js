const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

class TikTokDownloader {
    constructor(options = {}) {
        this.downloadDir = options.downloadDir || path.join(process.cwd(), 'scratch', 'tiktok');
        this.maxFileSize = options.maxFileSize || 100 * 1024 * 1024; // 100 MB max WhatsApp limit
        this.videoLimit = options.videoLimit || 16 * 1024 * 1024; // 16 MB WhatsApp standard video limit
        this.timeoutMs = options.timeoutMs || 45000;
        this.inFlightRequests = new Set();
        this.ytdlpBinary = options.ytdlpBinary || this._findYtDlpBinary();

        if (!fs.existsSync(this.downloadDir)) {
            fs.mkdirSync(this.downloadDir, { recursive: true });
        }
    }

    _findYtDlpBinary() {
        const localBin = path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
        if (fs.existsSync(localBin)) {
            return localBin;
        }
        return 'yt-dlp';
    }

    isValidUrl(url) {
        if (!url || typeof url !== 'string') return false;
        const trimmed = url.trim();
        const pattern = /^https?:\/\/([a-zA-Z0-9-]+\.)*(tiktok\.com|douyin\.com)(\/[^\s]*)?$/i;
        return pattern.test(trimmed);
    }

    extractUrl(text) {
        if (!text || typeof text !== 'string') return null;
        const match = text.match(/https?:\/\/([a-zA-Z0-9-]+\.)*(tiktok\.com|douyin\.com)\/[^\s]+/i);
        return match ? match[0] : null;
    }

    async resolveRedirect(shortUrl) {
        try {
            const res = await axios.get(shortUrl, {
                maxRedirects: 5,
                validateStatus: (status) => status >= 200 && status < 400,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });
            return res.request?.res?.responseUrl || shortUrl;
        } catch (e) {
            return shortUrl;
        }
    }

    async downloadWithYtDlp(url, outputPath) {
        return new Promise((resolve, reject) => {
            const args = [
                '--no-playlist',
                '--no-warnings',
                '-f', 'best[format_note!*=watermark]/best',
                '-o', outputPath,
                url
            ];

            const child = execFile(this.ytdlpBinary, args, { timeout: this.timeoutMs }, (error, stdout, stderr) => {
                if (error) {
                    return reject(new Error(`yt-dlp error: ${error.message} - ${stderr || stdout}`));
                }
                if (!fs.existsSync(outputPath)) {
                    return reject(new Error('yt-dlp did not produce output file'));
                }
                resolve({ path: outputPath, source: 'yt-dlp' });
            });
        });
    }

    async downloadWithApiFallback(url, outputPath) {
        const payload = { url: url, hd: 1 };
        const res = await axios.post('https://www.tikwm.com/api/', payload, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            timeout: this.timeoutMs
        });

        if (!res.data || res.data.code !== 0 || !res.data.data) {
            const msg = res.data?.msg || 'Could not parse TikTok link or video is private/unavailable';
            throw new Error(`API extraction failed: ${msg}`);
        }

        const videoInfo = res.data.data;
        const streamUrl = videoInfo.hdplay || videoInfo.play || videoInfo.wmplay;
        if (!streamUrl) {
            throw new Error('No downloadable video stream found');
        }

        const response = await axios.get(streamUrl, {
            responseType: 'stream',
            timeout: this.timeoutMs,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        const writer = fs.createWriteStream(outputPath);
        await new Promise((resolve, reject) => {
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        return {
            path: outputPath,
            title: videoInfo.title || '',
            duration: videoInfo.duration || 0,
            source: 'api'
        };
    }

    async download(url) {
        const valid = this.isValidUrl(url);
        if (!valid) {
            throw new Error('Invalid TikTok link.');
        }

        if (this.inFlightRequests.has(url)) {
            throw new Error('This video is currently being downloaded. Please wait.');
        }

        this.inFlightRequests.add(url);
        const fileId = `tt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const outputPath = path.join(this.downloadDir, `${fileId}.mp4`);

        try {
            let result = null;
            // 1. Try yt-dlp first as preferred
            try {
                result = await this.downloadWithYtDlp(url, outputPath);
            } catch (ytErr) {
                // 2. Fall back cleanly if yt-dlp faces anti-bot IP block or fails
                result = await this.downloadWithApiFallback(url, outputPath);
            }

            const stats = fs.statSync(outputPath);
            if (stats.size > this.maxFileSize) {
                this.cleanup(outputPath);
                throw new Error(`The requested video is too large (${(stats.size / (1024 * 1024)).toFixed(1)} MB). WhatsApp maximum limit is 100 MB.`);
            }

            return {
                filePath: outputPath,
                fileSize: stats.size,
                title: result.title || '',
                isDocument: stats.size > this.videoLimit
            };
        } finally {
            this.inFlightRequests.delete(url);
        }
    }

    cleanup(filePath) {
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                // ignore unlink errors
            }
        }
    }
}

module.exports = TikTokDownloader;
