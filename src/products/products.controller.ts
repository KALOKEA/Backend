import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { AddImageDto } from './dto/add-image.dto';
import { UpdateImageDto } from './dto/update-image.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';

@Controller('products')
export class ProductsController {
  constructor(private products: ProductsService) {}

  @Public()
  @Get()
  findAll(@Query() query: ProductQueryDto) {
    return this.products.findAll(query);
  }

  // --- Product images (admin). Declared before ':slug' so the literal
  //     'images' segment is never swallowed by the slug route. ---
  @UseGuards(AdminGuard)
  @Get(':id/images')
  listImages(@Param('id') id: string) {
    return this.products.listImages(id);
  }

  @UseGuards(AdminGuard)
  @Post(':id/images')
  addImage(@Param('id') id: string, @Body() dto: AddImageDto) {
    return this.products.addImage(id, dto);
  }

  @UseGuards(AdminGuard)
  @Patch('images/:imageId/primary')
  setPrimaryImage(@Param('imageId') imageId: string) {
    return this.products.setPrimaryImage(imageId);
  }

  @UseGuards(AdminGuard)
  @Patch('images/:imageId')
  updateImage(@Param('imageId') imageId: string, @Body() dto: UpdateImageDto) {
    return this.products.updateImage(imageId, dto);
  }

  @UseGuards(AdminGuard)
  @Delete('images/:imageId')
  deleteImage(@Param('imageId') imageId: string) {
    return this.products.deleteImage(imageId);
  }

  @Public()
  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.products.findBySlug(slug);
  }

  @UseGuards(AdminGuard)
  @AdminAction('product.create')
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @UseGuards(AdminGuard)
  @AdminAction('product.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateProductDto>) {
    return this.products.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @AdminAction('product.deactivate')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }
}
