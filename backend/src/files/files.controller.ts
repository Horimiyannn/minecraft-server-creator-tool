import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BulkResult, FilesService } from './files.service';
import { FileEntry } from './server-fs.service';
import { WriteFileDto } from './dto/write-file.dto';
import { FilePathDto } from './dto/file-path.dto';
import { RenameDto } from './dto/rename.dto';
import { PathsDto } from './dto/paths.dto';
import { ExtractDto } from './dto/extract.dto';
import { CompressDto } from './dto/compress.dto';

@UseGuards(JwtAuthGuard)
@Controller('servers/:id/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  list(
    @Param('id') id: string,
    @Query('path') path = '',
  ): Promise<FileEntry[]> {
    return this.filesService.list(id, path);
  }

  @Get('content')
  read(
    @Param('id') id: string,
    @Query('path') path: string,
  ): Promise<{ content: string; mtimeMs: number }> {
    return this.filesService.readText(id, path);
  }

  @Put('content')
  write(
    @Param('id') id: string,
    @Body() dto: WriteFileDto,
  ): Promise<{ mtimeMs: number }> {
    return this.filesService.writeText(id, dto.path, dto.content, dto.mtimeMs);
  }

  @Post('dir')
  mkdir(
    @Param('id') id: string,
    @Body() dto: FilePathDto,
  ): Promise<{ ok: true }> {
    return this.filesService.mkdir(id, dto.path);
  }

  @Post('rename')
  rename(
    @Param('id') id: string,
    @Body() dto: RenameDto,
  ): Promise<{ ok: true }> {
    return this.filesService.rename(id, dto.from, dto.to);
  }

  @Post('delete')
  remove(
    @Param('id') id: string,
    @Body() dto: PathsDto,
  ): Promise<BulkResult[]> {
    return this.filesService.removeMany(id, dto.paths);
  }

  @Get('search')
  search(
    @Param('id') id: string,
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ): Promise<string[]> {
    return this.filesService.search(id, q, limit);
  }

  @Post('extract')
  extract(
    @Param('id') id: string,
    @Body() dto: ExtractDto,
  ): Promise<{ ok: true }> {
    return this.filesService.extract(id, dto.path, dto.dest);
  }

  @Post('compress')
  compress(
    @Param('id') id: string,
    @Body() dto: CompressDto,
  ): Promise<{ ok: true }> {
    return this.filesService.compress(id, dto.paths, dto.dest);
  }
}
