import {
  Controller, Post, UseInterceptors, UploadedFile,
  UseGuards, Query, BadRequestException, ParseEnumPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { AdminGuard } from '../common/guards/admin.guard';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

/** Whitelist of Cloudinary folders admins are allowed to upload into (SEC-6). */
const ALLOWED_FOLDERS = ['products', 'banners', 'categories'] as const;
type UploadFolder = (typeof ALLOWED_FOLDERS)[number];

@Controller('upload')
export class UploadController {
  constructor(private upload: UploadService) {}

  @UseGuards(AdminGuard)
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        const ok = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : new BadRequestException('Only JPEG, PNG or WebP images are allowed'), ok);
      },
    }),
  )
  uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') rawFolder = 'products',
  ) {
    if (!file) throw new BadRequestException('No file received — make sure the field name is "file"');
    // Whitelist the folder to prevent path-traversal in Cloudinary (SEC-6).
    const folder: UploadFolder = ALLOWED_FOLDERS.includes(rawFolder as UploadFolder)
      ? (rawFolder as UploadFolder)
      : 'products';
    return this.upload.uploadImage(file, folder);
  }
}
