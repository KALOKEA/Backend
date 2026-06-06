import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private config: ConfigService) {}

  private getCredentials() {
    const cloudName = this.config.get('CLOUDINARY_CLOUD_NAME');
    const apiKey    = this.config.get('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiKey || !apiSecret) {
      const missing = [
        !cloudName  && 'CLOUDINARY_CLOUD_NAME',
        !apiKey     && 'CLOUDINARY_API_KEY',
        !apiSecret  && 'CLOUDINARY_API_SECRET',
      ].filter(Boolean).join(', ');
      this.logger.error(`Upload failed — missing Railway env vars: ${missing}`);
      throw new BadRequestException(
        `Upload is not configured. Add these Railway env vars: ${missing}. ` +
        'Get them from cloudinary.com → Settings → Access Keys.',
      );
    }
    return { cloudName, apiKey, apiSecret };
  }

  async uploadImage(file: Express.Multer.File, folder = 'products'): Promise<{ url: string; public_id: string }> {
    return this.uploadMedia(file, folder);
  }

  /** Upload any image or video file to Cloudinary. Routes to /image/upload or /video/upload. */
  async uploadMedia(file: Express.Multer.File, folder = 'reviews'): Promise<{ url: string; public_id: string }> {
    const { cloudName, apiKey, apiSecret } = this.getCredentials();

    const isVideo = file.mimetype.startsWith('video/');
    const resourceType = isVideo ? 'video' : 'image';

    const formData = new FormData();
    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;

    const crypto = await import('crypto');
    const signature = crypto
      .createHash('sha1')
      .update(paramsToSign + apiSecret)
      .digest('hex');

    const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
    formData.append('file', blob, file.originalname);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp.toString());
    formData.append('folder', folder);
    formData.append('signature', signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
      { method: 'POST', body: formData },
    );

    if (!response.ok) {
      const err = await response.json() as any;
      this.logger.error('Cloudinary upload error:', JSON.stringify(err));
      throw new BadRequestException(err.error?.message || 'Cloudinary upload failed');
    }

    const result = await response.json() as any;
    this.logger.log(`Uploaded ${file.originalname} (${resourceType}) → ${result.secure_url}`);
    return { url: result.secure_url, public_id: result.public_id };
  }
}
