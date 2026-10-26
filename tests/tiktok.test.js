const path = require('path');
const fs = require('fs');
const TikTokDownloader = require('../src/tiktok');

describe('TikTokDownloader', () => {
    let downloader;
    const testDir = path.join(process.cwd(), 'scratch', 'test_tiktok_unit');

    beforeAll(() => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        downloader = new TikTokDownloader({
            downloadDir: testDir,
            maxFileSize: 10 * 1024 * 1024, // 10 MB limit for test
            videoLimit: 2 * 1024 * 1024    // 2 MB limit for test
        });
    });

    describe('URL Validation and Extraction', () => {
        test('recognizes valid TikTok URLs', () => {
            expect(downloader.isValidUrl('https://www.tiktok.com/@user/video/7106594312292453678')).toBe(true);
            expect(downloader.isValidUrl('https://vm.tiktok.com/ZM8abc123/')).toBe(true);
            expect(downloader.isValidUrl('https://vt.tiktok.com/ZS123456/')).toBe(true);
            expect(downloader.isValidUrl('http://tiktok.com/@creator/video/12345')).toBe(true);
        });

        test('rejects invalid or non-TikTok URLs', () => {
            expect(downloader.isValidUrl('https://www.youtube.com/watch?v=123')).toBe(false);
            expect(downloader.isValidUrl('not-a-url')).toBe(false);
            expect(downloader.isValidUrl(null)).toBe(false);
            expect(downloader.isValidUrl('')).toBe(false);
        });

        test('extracts TikTok URL embedded in text', () => {
            const extracted = downloader.extractUrl('Check this out: https://vm.tiktok.com/ZM8abc123/ it is awesome');
            expect(extracted).toBe('https://vm.tiktok.com/ZM8abc123/');
        });
    });

    describe('Download and Resource Limits', () => {
        test('prevents duplicate concurrent downloads for the same URL', async () => {
            const testUrl = 'https://www.tiktok.com/@user/video/999999999';
            downloader.downloadWithYtDlp = jest.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)));

            const firstDownload = downloader.download(testUrl);
            await expect(downloader.download(testUrl)).rejects.toThrow('This video is currently being downloaded. Please wait.');
            await expect(firstDownload).rejects.toThrow(); // because mock did not create file
        });

        test('marks isDocument to true when file size exceeds videoLimit', async () => {
            const testUrl = 'https://www.tiktok.com/@user/video/111111111';
            const fakeFilePath = path.join(testDir, 'fake_large.mp4');

            downloader.downloadWithYtDlp = jest.fn().mockImplementation(async (url, outputPath) => {
                // Write 3 MB (exceeds videoLimit of 2 MB, but within maxFileSize of 10 MB)
                fs.writeFileSync(outputPath, Buffer.alloc(3 * 1024 * 1024));
                return { path: outputPath, source: 'yt-dlp', title: 'Large Video' };
            });

            const result = await downloader.download(testUrl);
            expect(result.isDocument).toBe(true);
            expect(result.fileSize).toBe(3 * 1024 * 1024);

            downloader.cleanup(result.filePath);
            expect(fs.existsSync(result.filePath)).toBe(false);
        });

        test('throws error and cleans up file when size exceeds maxFileSize (100MB limit)', async () => {
            const testUrl = 'https://www.tiktok.com/@user/video/222222222';

            downloader.downloadWithYtDlp = jest.fn().mockImplementation(async (url, outputPath) => {
                // Write 12 MB (exceeds maxFileSize of 10 MB)
                fs.writeFileSync(outputPath, Buffer.alloc(12 * 1024 * 1024));
                return { path: outputPath, source: 'yt-dlp' };
            });

            await expect(downloader.download(testUrl)).rejects.toThrow('The requested video is too large');
        });

        test('cleans up temporary files without errors', () => {
            const tempFile = path.join(testDir, 'temp_cleanup.mp4');
            fs.writeFileSync(tempFile, 'test');
            expect(fs.existsSync(tempFile)).toBe(true);

            downloader.cleanup(tempFile);
            expect(fs.existsSync(tempFile)).toBe(false);

            // Calling cleanup on non-existent file should not throw
            expect(() => downloader.cleanup(tempFile)).not.toThrow();
        });
    });
});
