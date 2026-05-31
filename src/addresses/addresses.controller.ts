import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('addresses')
export class AddressesController {
  constructor(private addresses: AddressesService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.addresses.findAll(user.id);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateAddressDto) {
    return this.addresses.create(user.id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: Partial<CreateAddressDto>) {
    return this.addresses.update(id, user.id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.addresses.remove(id, user.id);
  }

  @Patch(':id/default')
  setDefault(@Param('id') id: string, @CurrentUser() user: any) {
    return this.addresses.setDefault(id, user.id);
  }
}
