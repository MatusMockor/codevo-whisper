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
  NSString *_runLanguage;
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
- (NSArray<NSString *> *)supportedEvents { return @[@"CodevoVoiceEvent",@"CodevoLanguageChanged"]; }
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
- (NSString *)selectedLanguage {
  return [[NSUserDefaults standardUserDefaults] stringForKey:@"voice-language"] ?: @"auto";
}
RCT_EXPORT_METHOD(getLanguage:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { resolve([self selectedLanguage]); }
RCT_EXPORT_METHOD(setLanguage:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_runId || ![@[@"auto",@"sk",@"en",@"cs"] containsObject:value]) { reject(@"settings_error",@"Language unavailable during recording or invalid",nil);return; }
  [[NSUserDefaults standardUserDefaults] setObject:value forKey:@"voice-language"];
  [self sendEventWithName:@"CodevoLanguageChanged" body:[self selectedLanguage]];
  resolve(nil);
}
RCT_EXPORT_METHOD(runLanguage:(NSString *)run resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (![_runId isEqualToString:run]) { reject(@"recording_error",@"Recording cancelled",nil);return; }
  resolve(_runLanguage);
}
RCT_EXPORT_METHOD(setupStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(@{@"microphone":@([AVAudioSession sharedInstance].recordPermission==AVAudioSessionRecordPermissionGranted),@"keyboard":@"notApplicable"});
}
RCT_EXPORT_METHOD(beginCompanion:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_runId || UIApplication.sharedApplication.applicationState!=UIApplicationStateActive) { reject(@"recording_error",@"Recorder unavailable",nil);return; }
  @synchronized(self) { _runId=NSUUID.UUID.UUIDString;_runLanguage=[self selectedLanguage];_finishing=NO; } resolve(_runId);
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

@interface CodevoSocketState : NSObject
@property(nonatomic,strong) NSURLSession *session;
@property(nonatomic,strong) NSURLSessionWebSocketTask *task;
@property(nonatomic,copy) RCTPromiseResolveBlock opening;
@property(nonatomic,copy) RCTPromiseRejectBlock openingFailure;
@property(nonatomic,copy) RCTPromiseRejectBlock sendFailure;
@property(nonatomic,strong) NSObject *sending;
@property(nonatomic,assign) BOOL opened;
@end
@implementation CodevoSocketState
@end

@interface CodevoSocket : RCTEventEmitter <RCTBridgeModule,NSURLSessionWebSocketDelegate>
@end
@implementation CodevoSocket {
  NSMutableDictionary<NSString *,CodevoSocketState *> *_sockets;
  BOOL _invalidated;
}
RCT_EXPORT_MODULE(CodevoSocket)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"CodevoSocketEvent"]; }
- (instancetype)init { if ((self=[super init])) _sockets=[NSMutableDictionary new];return self; }
- (void)closeSocket:(NSString *)identifier {
  CodevoSocketState *state=_sockets[identifier];
  if (!state) return;
  [_sockets removeObjectForKey:identifier];
  [state.task cancelWithCloseCode:NSURLSessionWebSocketCloseCodeGoingAway reason:nil];
  [state.session invalidateAndCancel];
  if (state.openingFailure) state.openingFailure(@"socket_error",@"Socket closed",nil);
  if (state.sendFailure) state.sendFailure(@"socket_error",@"Socket closed or stalled",nil);
  state.opening=nil;state.openingFailure=nil;state.sendFailure=nil;state.sending=nil;
}
- (void)failSocket:(NSString *)identifier {
  if (!_sockets[identifier]) return;
  [self closeSocket:identifier];
  [self sendEventWithName:@"CodevoSocketEvent" body:@{@"id":identifier,@"type":@"failed"}];
}
- (NSString *)identifierForTask:(NSURLSessionTask *)task {
  for (NSString *identifier in _sockets) if (_sockets[identifier].task==task) return identifier;
  return nil;
}
- (void)receiveSocket:(NSString *)identifier state:(CodevoSocketState *)state {
  [state.task receiveMessageWithCompletionHandler:^(NSURLSessionWebSocketMessage *message,NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self->_sockets[identifier]!=state) return;
      if (error || message.type!=NSURLSessionWebSocketMessageTypeData || message.data.length>65535) { [self failSocket:identifier];return; }
      [self sendEventWithName:@"CodevoSocketEvent" body:@{@"id":identifier,@"type":@"frame",@"data":[message.data base64EncodedStringWithOptions:0]}];
      [self receiveSocket:identifier state:state];
    });
  }];
}
RCT_EXPORT_METHOD(connect:(NSString *)identifier endpoint:(NSString *)endpoint resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSURL *url=[NSURL URLWithString:endpoint];
  if (_invalidated || _sockets[identifier] || _sockets.count>=4 || ![url.scheme.lowercaseString isEqualToString:@"wss"]) { reject(@"socket_error",@"TLS socket unavailable",nil);return; }
  CodevoSocketState *state=[CodevoSocketState new];
  state.opening=resolve;state.openingFailure=reject;
  NSURLSessionConfiguration *configuration=[NSURLSessionConfiguration ephemeralSessionConfiguration];
  configuration.timeoutIntervalForRequest=15;
  state.session=[NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:NSOperationQueue.mainQueue];
  state.task=[state.session webSocketTaskWithURL:url];state.task.maximumMessageSize=65535;
  _sockets[identifier]=state;
  [state.task resume];
  [self receiveSocket:identifier state:state];
}
RCT_EXPORT_METHOD(send:(NSString *)identifier data:(NSString *)encoded resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  CodevoSocketState *state=_sockets[identifier];
  NSData *data=encoded.length<=85336 ? [[NSData alloc] initWithBase64EncodedString:encoded options:0] : nil;
  if (!state || !state.opened || state.sending || !data || data.length==0 || data.length>64000) { reject(@"socket_error",@"Socket unavailable or full",nil);[self failSocket:identifier];return; }
  NSObject *attempt=[NSObject new];state.sending=attempt;state.sendFailure=reject;
  [state.task sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithData:data] completionHandler:^(NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self->_sockets[identifier]!=state || state.sending!=attempt) return;
      if (error) { [self failSocket:identifier];return; }
      state.sending=nil;state.sendFailure=nil;resolve(nil);
    });
  }];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,10*NSEC_PER_SEC),dispatch_get_main_queue(), ^{
    if (self->_sockets[identifier]==state && state.sending==attempt) [self failSocket:identifier];
  });
}
RCT_EXPORT_METHOD(close:(NSString *)identifier) { [self closeSocket:identifier]; }
- (void)URLSession:(NSURLSession *)session webSocketTask:(NSURLSessionWebSocketTask *)task didOpenWithProtocol:(NSString *)protocol {
  NSString *identifier=[self identifierForTask:task];
  CodevoSocketState *state=identifier ? _sockets[identifier] : nil;
  if (!state) return;
  state.opened=YES;
  if (state.opening) state.opening(nil);
  state.opening=nil;state.openingFailure=nil;
}
- (void)URLSession:(NSURLSession *)session webSocketTask:(NSURLSessionWebSocketTask *)task didCloseWithCode:(NSURLSessionWebSocketCloseCode)code reason:(NSData *)reason {
  NSString *identifier=[self identifierForTask:task];if (identifier) [self failSocket:identifier];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
  NSString *identifier=[self identifierForTask:task];if (identifier) [self failSocket:identifier];
}
- (void)invalidate {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_invalidated=YES;
    for (NSString *identifier in [self->_sockets.allKeys copy]) [self closeSocket:identifier];
    [super invalidate];
  });
}
@end
