import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private config: ConfigService) {}

  async uploadImage(file: Express.Multer.File, folder = 'products'): Promise<{ url: string; public_id: string }> {
    const cloudName = this.config.get('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
      throw new BadRequestException('Cloudinary not configured');
    }

    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, WebP images allowed');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Max file size is 5MB');
    }

    const formData = new FormData();
    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;

    const crypto = await import('crypto');
    const signature = crypto
      .createHash('sha1')
      .update(paramsToSign + apiSecret)
      .digest('hex');

    const blob = new Blob([file.buffer], { type: file.mimetype });
    formData.append('file', blob, file.originalname);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp.toString());
    formData.append('folder', folder);
    formData.append('signature', signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: 'POST', body: formData },
    );

    if (!response.ok) {
      const err = await response.json() as any;
      this.logger.error('Cloudinary error:', err);
      throw new BadRequestException(err.error?.message || 'Upload failed');
    }

    const result = await response.json() as any;
    return {
      url: result.secure_url,
      public_id: result.public_id,
    };
  }
}
