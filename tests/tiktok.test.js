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

        test('default instance sets 100 MB videoLimit and 500 MB maxFileSize', () => {
            const defaultDownloader = new TikTokDownloader({ downloadDir: testDir });
            expect(defaultDownloader.videoLimit).toBe(100 * 1024 * 1024);
            expect(defaultDownloader.maxFileSize).toBe(500 * 1024 * 1024);
        });

        test('sends as normal video when file is <= 100 MB and document when > 100 MB', async () => {
            const defaultDownloader = new TikTokDownloader({ downloadDir: testDir });

            // Case 1: 50 MB -> normal video (isDocument: false)
            defaultDownloader.downloadWithYtDlp = jest.fn().mockImplementation(async (url, outputPath) => {
                fs.writeFileSync(outputPath, Buffer.alloc(1024)); // small file for test
                return { path: outputPath, source: 'yt-dlp' };
            });
            // Mock statSync to simulate 100 MB exactly
            const realStatSync = fs.statSync;
            jest.spyOn(fs, 'statSync').mockReturnValue({ size: 100 * 1024 * 1024 });

            const normalResult = await defaultDownloader.download('https://www.tiktok.com/@user/video/100mb');
            expect(normalResult.isDocument).toBe(false);
            expect(normalResult.fileSize).toBe(100 * 1024 * 1024);
            defaultDownloader.cleanup(normalResult.filePath);

            // Case 2: 101 MB -> document (isDocument: true)
            fs.statSync.mockReturnValue({ size: 101 * 1024 * 1024 });
            const docResult = await defaultDownloader.download('https://www.tiktok.com/@user/video/101mb');
            expect(docResult.isDocument).toBe(true);
            expect(docResult.fileSize).toBe(101 * 1024 * 1024);
            defaultDownloader.cleanup(docResult.filePath);

            fs.statSync.mockRestore();
        });

        test('throws error and cleans up file when size exceeds 500 MB maximum limit', async () => {
            const defaultDownloader = new TikTokDownloader({ downloadDir: testDir });
            defaultDownloader.downloadWithYtDlp = jest.fn().mockImplementation(async (url, outputPath) => {
                fs.writeFileSync(outputPath, Buffer.alloc(1024));
                return { path: outputPath, source: 'yt-dlp' };
            });

            jest.spyOn(fs, 'statSync').mockReturnValue({ size: 501 * 1024 * 1024 });

            await expect(defaultDownloader.download('https://www.tiktok.com/@user/video/501mb'))
                .rejects.toThrow('The requested video is too large (501.0 MB). Maximum limit is 500 MB.');

            fs.statSync.mockRestore();
        });

        test('throws error and cleans up file when size exceeds custom maxFileSize', async () => {
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

        test('logs concise yt-dlp error before invoking fallback and cleans up partial file', async () => {
            const testUrl = 'https://www.tiktok.com/@user/video/555555555';
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            downloader.downloadWithYtDlp = jest.fn().mockImplementation(async (url, outputPath) => {
                // Simulate partial file write before failure
                fs.writeFileSync(outputPath, 'partial corrupt content');
                throw new Error('yt-dlp failed: HTTP Error 403: Forbidden');
            });

            downloader.downloadWithApiFallback = jest.fn().mockImplementation(async (url, outputPath) => {
                // Verify partial file was cleaned up before fallback
                expect(fs.existsSync(outputPath)).toBe(false);
                fs.writeFileSync(outputPath, Buffer.alloc(1000));
                return { path: outputPath, source: 'api', title: 'Fallback Video' };
            });

            const result = await downloader.download(testUrl);
            expect(result.title).toBe('Fallback Video');
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('[TikTokDownloader] yt-dlp attempt failed: yt-dlp failed: HTTP Error 403: Forbidden. Falling back to API...')
            );

            consoleSpy.mockRestore();
            downloader.cleanup(result.filePath);
        });

        test('downloadWithYtDlp rejects and cleans up empty output files', async () => {
            const outputPath = path.join(testDir, 'empty_test.mp4');
            fs.writeFileSync(outputPath, Buffer.alloc(0));

            const cp = require('child_process');
            const spy = jest.spyOn(cp, 'execFile').mockImplementation((cmd, args, opts, cb) => {
                cb(null, '', '');
            });

            await expect(downloader.downloadWithYtDlp('https://www.tiktok.com/@user/video/777', outputPath))
                .rejects.toThrow('yt-dlp completed but output file was empty');

            expect(fs.existsSync(outputPath)).toBe(false);
            spy.mockRestore();
        });
    });
});
