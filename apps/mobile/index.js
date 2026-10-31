import './bootstrap';
import { AppRegistry } from 'react-native';
import { App } from './src/App';
import { runHeadless } from './src/runtime';
AppRegistry.registerComponent('CodevoMobile', () => App);
AppRegistry.registerHeadlessTask('CodevoDictation', () => runHeadless);
