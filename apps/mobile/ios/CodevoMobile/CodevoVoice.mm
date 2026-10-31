#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>
#import <Security/Security.h>
#import <UIKit/UIKit.h>
#import <math.h>

@interface CodevoVoice : RCTEventEmitter <RCTBridgeModule>
@end

@implementation CodevoVoice {
  NSString *_runId;
  BOOL _finishing;
  AVAudioEngine *_engine;
  AVAudioConverter *_converter;
  NSMutableData *_pcm;
  NSMutableSet<NSNumber *> *_pending;
  NSInteger _sequence;
}
RCT_EXPORT_MODULE(CodevoVoice)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"CodevoVoiceEvent"]; }
- (instancetype)init {
  if ((self = [super init])) {
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(background:) name:UIApplicationDidEnterBackgroundNotification object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(interrupted:) name:AVAudioSessionInterruptionNotification object:nil];
  }
  return self;
}
- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; }
- (void)background:(NSNotification *)note { [self cancelRun]; }
- (void)interrupted:(NSNotification *)note { [self cancelRun]; }
- (void)emit:(NSString *)type run:(NSString *)run {
  if (run) [self sendEventWithName:@"CodevoVoiceEvent" body:@{@"type":type,@"runId":run}];
}
- (NSDictionary *)vaultQuery {
  return @{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"com.codevo.mobile.pairing",(__bridge id)kSecAttrAccount:@"device-v1"};
}
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(randomBytes:(NSNumber *)size) {
  NSInteger count=size.integerValue;
  if (count<0 || count>65536) @throw [NSException exceptionWithName:@"SecureRandom" reason:@"Invalid random buffer" userInfo:nil];
  NSMutableData *data=[NSMutableData dataWithLength:count];
  if (SecRandomCopyBytes(kSecRandomDefault,count,data.mutableBytes)!=errSecSuccess) @throw [NSException exceptionWithName:@"SecureRandom" reason:@"Native randomness unavailable" userInfo:nil];
  return [data base64EncodedStringWithOptions:0];
}
RCT_EXPORT_METHOD(loadPairing:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *query=[[self vaultQuery] mutableCopy];
  query[(__bridge id)kSecReturnData]=@YES;
  CFTypeRef result=NULL;
  OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&result);
  if (status==errSecItemNotFound) { resolve([NSNull null]);return; }
  if (status!=errSecSuccess) { reject(@"vault_error",@"Protected pairing unavailable",nil);return; }
  NSData *data=CFBridgingRelease(result);
  NSString *value=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  if (!value || data.length>16384) { reject(@"vault_error",@"Protected pairing invalid",nil);return; }
  resolve(value);
}
RCT_EXPORT_METHOD(savePairing:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSData *data=[value dataUsingEncoding:NSUTF8StringEncoding];
  if (!data || data.length>16384) { reject(@"vault_error",@"Pairing too large",nil);return; }
  NSDictionary *attributes=@{(__bridge id)kSecValueData:data,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly};
  OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)[self vaultQuery],(__bridge CFDictionaryRef)attributes);
  if (status==errSecItemNotFound) {
    NSMutableDictionary *query=[[self vaultQuery] mutableCopy];[query addEntriesFromDictionary:attributes];
    status=SecItemAdd((__bridge CFDictionaryRef)query,NULL);
  }
  if (status!=errSecSuccess) { reject(@"vault_error",@"Pairing could not be saved",nil);return; }
  resolve(nil);
}
RCT_EXPORT_METHOD(removePairing:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self cancelRun];
  OSStatus status=SecItemDelete((__bridge CFDictionaryRef)[self vaultQuery]);
  if (status!=errSecSuccess && status!=errSecItemNotFound) { reject(@"vault_error",@"Pairing could not be removed",nil);return; }
  resolve(nil);
}
RCT_EXPORT_METHOD(requestMicrophone:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [[AVAudioSession sharedInstance] requestRecordPermission:^(BOOL granted) { resolve(@(granted)); }];
}
RCT_EXPORT_METHOD(beginCompanion:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_runId || UIApplication.sharedApplication.applicationState!=UIApplicationStateActive) { reject(@"recording_error",@"Recorder unavailable",nil);return; }
  @synchronized(self) { _runId=NSUUID.UUID.UUIDString;_finishing=NO; } resolve(_runId);
}
RCT_EXPORT_METHOD(ready:(NSString *)run resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { resolve(@([_runId isEqualToString:run])); }
- (void)enqueuePCM:(NSData *)data run:(NSString *)run {
  @synchronized(self) {
    if (![_runId isEqualToString:run]) return;
    if (_pending.count>=8) { dispatch_async(dispatch_get_main_queue(), ^{ [self cancelRun]; });return; }
    NSNumber *sequence=@(_sequence++);[_pending addObject:sequence];
    NSString *encoded=[data base64EncodedStringWithOptions:0];
    dispatch_async(dispatch_get_main_queue(), ^{
      if ([self->_runId isEqualToString:run]) [self sendEventWithName:@"CodevoVoiceEvent" body:@{@"type":@"pcm",@"runId":run,@"sequence":sequence,@"pcm":encoded}];
    });
  }
}
RCT_EXPORT_METHOD(capture:(NSString *)run resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (![_runId isEqualToString:run] || _finishing || _engine || UIApplication.sharedApplication.applicationState!=UIApplicationStateActive) { reject(@"recording_error",@"Recording cancelled",nil);return; }
  NSError *error=nil;
  AVAudioSession *session=[AVAudioSession sharedInstance];
  if (![session setCategory:AVAudioSessionCategoryRecord mode:AVAudioSessionModeMeasurement options:0 error:&error] || ![session setActive:YES error:&error]) { reject(@"microphone_error",@"Microphone unavailable",nil);return; }
  _engine=[AVAudioEngine new];
  AVAudioInputNode *input=_engine.inputNode;
  AVAudioFormat *source=[input outputFormatForBus:0];
  AVAudioFormat *format=[[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16 sampleRate:16000 channels:1 interleaved:YES];
  _converter=[[AVAudioConverter alloc] initFromFormat:source toFormat:format];
  if (!_converter || source.sampleRate<=0) { [self cancelRun];reject(@"microphone_error",@"Audio format unavailable",nil);return; }
  _pcm=[NSMutableData new];_pending=[NSMutableSet new];_sequence=0;
  [input installTapOnBus:0 bufferSize:2048 format:source block:^(AVAudioPCMBuffer *buffer,AVAudioTime *when) {
    @synchronized(self) {
      if (![self->_runId isEqualToString:run]) return;
      AVAudioFrameCount capacity=(AVAudioFrameCount)ceil(buffer.frameLength*16000.0/source.sampleRate)+32;
      AVAudioPCMBuffer *output=[[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:capacity];
      __block BOOL consumed=NO;
      NSError *conversionError=nil;
      AVAudioConverterOutputStatus status=[self->_converter convertToBuffer:output error:&conversionError withInputFromBlock:^AVAudioBuffer *(AVAudioPacketCount count,AVAudioConverterInputStatus *state) {
        if (consumed) { *state=AVAudioConverterInputStatus_NoDataNow;return nil; }
        consumed=YES;*state=AVAudioConverterInputStatus_HaveData;return buffer;
      }];
      if (status==AVAudioConverterOutputStatus_Error || conversionError) { dispatch_async(dispatch_get_main_queue(), ^{ [self cancelRun]; });return; }
      [self->_pcm appendBytes:output.audioBufferList->mBuffers[0].mData length:output.frameLength*2];
      while (self->_pcm.length>=3200) {
        [self enqueuePCM:[self->_pcm subdataWithRange:NSMakeRange(0,3200)] run:run];
        [self->_pcm replaceBytesInRange:NSMakeRange(0,3200) withBytes:NULL length:0];
      }
    }
  }];
  if (![_engine startAndReturnError:&error]) { [self cancelRun];reject(@"microphone_error",@"Microphone failed to start",nil);return; }
  resolve(nil);
}
- (void)releaseAudio {
  if (_engine) { [_engine.inputNode removeTapOnBus:0];[_engine stop];_engine=nil; }
  [[AVAudioSession sharedInstance] setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];
}
RCT_EXPORT_METHOD(acknowledge:(NSString *)run sequence:(NSNumber *)sequence) { @synchronized(self) { if ([_runId isEqualToString:run]) [_pending removeObject:sequence]; } }
RCT_EXPORT_METHOD(stopCapture:(NSString *)run resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if ([_runId isEqualToString:run]) {
    [self releaseAudio];
    @synchronized(self) { if (_pcm.length) { [self enqueuePCM:[_pcm copy] run:run];[_pcm setLength:0]; } }
    dispatch_async(dispatch_get_main_queue(), ^{ [self emit:@"ended" run:run]; });
  }
  resolve(nil);
}
RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_runId && !_finishing) { _finishing=YES;[self emit:@"stop" run:_runId]; } resolve(nil);
}
- (void)cancelRun {
  NSString *run;
  @synchronized(self) { run=_runId;_runId=nil; }
  [self releaseAudio];
  @synchronized(self) { _pcm=nil;_pending=nil; }
  [self emit:@"cancel" run:run];
}
RCT_EXPORT_METHOD(cancel:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { [self cancelRun];resolve(nil); }
RCT_EXPORT_METHOD(terminal:(NSString *)run message:(NSString *)message resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { if ([_runId isEqualToString:run]) [self cancelRun];resolve(nil); }
RCT_EXPORT_METHOD(complete:(NSString *)run text:(NSString *)text resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  BOOL valid=[_runId isEqualToString:run] && _finishing && UIApplication.sharedApplication.applicationState==UIApplicationStateActive;
  if (valid) { @synchronized(self) { _runId=nil; } [self releaseAudio];@synchronized(self) { _pcm=nil;_pending=nil; } } resolve(@(valid));
}
@end
