import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { VariantsService } from './variants.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('variants')
@ApiBearerAuth('access-token')
@Controller('variants')
export class VariantsController {
  constructor(private variants: VariantsService) {}

  @Public()
  @Get('product/:productId')
  findByProduct(@Param('productId') productId: string) {
    return this.variants.findByProduct(productId);
  }

  @UseGuards(AdminGuard)
  @AdminAction('variant.create')
  @Post()
  create(@Body() dto: CreateVariantDto) {
    return this.variants.create(dto);
  }

  @UseGuards(AdminGuard)
  @AdminAction('variant.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.variants.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @AdminAction('variant.delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.variants.remove(id);
  }
}
