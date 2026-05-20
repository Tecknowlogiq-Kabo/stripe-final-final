import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3Service } from './s3.service';

describe('S3Service', () => {
  let service: S3Service;

  const mockConfig: Record<string, any> = {
    'aws.region': 'us-east-1',
    'aws.accessKeyId': 'test-key',
    'aws.secretAccessKey': 'test-secret',
    'aws.s3Bucket': 'test-bucket',
    'aws.s3TrustPrefix': 'trust-approved/',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => mockConfig[key] ?? null },
        },
      ],
    }).compile();

    service = module.get<S3Service>(S3Service);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate a presigned GET URL', async () => {
    const url = await service.presignedGetUrl('test-file.pdf', 600);
    expect(url).toBeDefined();
    expect(url).toContain('https://');
    expect(url).toContain('test-bucket');
    expect(url).toContain('trust-approved/test-file.pdf');
  });

  it('should generate a presigned PUT URL', async () => {
    const url = await service.presignedPutUrl('upload.pdf', 600, 'application/pdf');
    expect(url).toBeDefined();
    expect(url).toContain('https://');
    expect(url).toContain('test-bucket');
    expect(url).toContain('trust-approved/upload.pdf');
  });

  it('should prefix keys with trustPrefix on upload', async () => {
    // Key returned by upload includes the prefix
    const spy = jest.spyOn((service as any).client, 'send').mockResolvedValueOnce({ ETag: '"abc123"' });

    const result = await service.upload('doc.pdf', Buffer.from('test'), 'application/pdf');

    expect(result.key).toBe('trust-approved/doc.pdf');
    expect(result.etag).toBe('"abc123"');
    spy.mockRestore();
  });
});
