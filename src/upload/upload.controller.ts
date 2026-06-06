import {
  Controller, Post, UseInterceptors, UploadedFile,
  UseGuards, Query, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { AdminGuard } from '../common/guards/admin.guard';

const MAX_SIZE_IMAGE = 5 * 1024 * 1024;   // 5 MB
const MAX_SIZE_MEDIA = 30 * 1024 * 1024;  // 30 MB (covers short videos)

const ALLOWED_FOLDERS = ['products', 'banners', 'categories'] as const;
type UploadFolder = (typeof ALLOWED_FOLDERS)[number];

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_MEDIA_TYPES = [...ALLOWED_IMAGE_TYPES, 'video/mp4', 'video/quicktime', 'video/webm'];

@Controller('upload')
export class UploadController {
  constructor(private upload: UploadService) {}

  /** Admin-only: product / banner images. */
  @UseGuards(AdminGuard)
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE_IMAGE },
      fileFilter: (_req, file, cb) => {
        const ok = ALLOWED_IMAGE_TYPES.includes(file.mimetype);
        cb(ok ? null : new BadRequestException('Only JPEG, PNG or WebP images are allowed'), ok);
      },
    }),
  )
  uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') rawFolder = 'products',
  ) {
    if (!file) throw new BadRequestException('No file received — field name must be "file"');
    const folder: UploadFolder = ALLOWED_FOLDERS.includes(rawFolder as UploadFolder)
      ? (rawFolder as UploadFolder)
      : 'products';
    return this.upload.uploadImage(file, folder);
  }

  /**
   * Any authenticated user: upload a photo or short video to attach to a review.
   * Accepts JPEG, PNG, WebP, MP4, MOV, WebM (max 30 MB).
   */
  @Post('review-media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE_MEDIA },
      fileFilter: (_req, file, cb) => {
        const ok = ALLOWED_MEDIA_TYPES.includes(file.mimetype);
        cb(ok ? null : new BadRequestException('Only images (JPEG/PNG/WebP) or short videos (MP4/MOV/WebM) are allowed'), ok);
      },
    }),
  )
  uploadReviewMedia(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file received — field name must be "file"');
    return this.upload.uploadMedia(file, 'reviews');
  }
}
