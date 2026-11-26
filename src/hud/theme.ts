export const theme = {
  alert: false,
  get main() {
    return this.alert ? '#ff3b3b' : '#00e5ff';
  },
  get mainRgb() {
    return this.alert ? '255, 59, 59' : '0, 229, 255';
  },
  gold: '#ffc940',
};
