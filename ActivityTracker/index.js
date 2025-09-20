/**
 * @format
 */

import { AppRegistry, Platform } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

if (Platform.OS === 'android') {
AppRegistry.registerComponent('main', () => App);
}else if(Platform.OS === 'web'){
	AppRegistry.registerComponent(appName, () => App);
AppRegistry.runApplication(appName, {
  rootTag: document.getElementById('root'),
});

}else{
AppRegistry.registerComponent(appName, () => App);
}